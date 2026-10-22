// Tilføjer linjer til en EKSISTERENDE ordre.
//
// Id'et i adressen er enten portalens eget ordre-id eller BC's salgsordre-GUID —
// kunden skal kunne tilføje til en ordre hun har ringet ind, ikke kun til dem hun har
// bestilt online. findTilfoejMaal slår begge op og afgør ejerskab og frist ét sted,
// så siden og dette endepunkt ikke kan blive uenige om hvad der er tilladt.

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { addLinesToBCOrder, getCartCoverage, getCustomerLocationCode } from '@/lib/businesscentral'
import { findTilfoejMaal } from '@/lib/tilfoejOrdre'

// Leveringsdatoen som dansk kalenderdag (YYYY-MM-DD) — uafhængigt af serverens tidszone.
function ymd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(d)
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const maal = await findTilfoejMaal(params.id, session)
  if (!maal) {
    return NextResponse.json({
      error: 'Ordren findes ikke længere hos Venmark — den kan være samlet med en anden ordre. ' +
             'Bestil varerne som en ny bestilling under "Bestil", eller kontakt os.',
    }, { status: 404 })
  }
  if (new Date() > maal.deadline) {
    return NextResponse.json({ error: 'Fristen for denne leveringsdato er passeret' }, { status: 422 })
  }

  const { lines } = await req.json()
  if (!lines?.length) {
    return NextResponse.json({ error: 'Ingen linjer' }, { status: 400 })
  }

  // ── Antals-loft (samme som ny bestilling) ───────────────────────────────────
  // Endepunktet tjekkede FØR kun fristen → man kunne lægge 30 kg på, og bagefter 8 mere,
  // af en vare hvor alt var solgt (32745 på W0000095, 20-10-2026). BC's coverage er facit:
  // ordrens EGNE eksisterende linjer er allerede salg i BC og trækkes fra; de nye linjer
  // sendes som kurv (søsken med fælles råvare nettes, varen selv ekskluderes). Samme vare
  // på flere nye linjer summeres. Fail-open ved BC-fejl (som ordre-ruten) — men aldrig
  // ubegrænset når BC svarer.
  const nyePrVare = new Map<string, { qty: number; name: string }>()
  for (const l of lines as any[]) {
    if (!l?.bcItemNumber || !(l.quantity > 0)) continue
    const cur = nyePrVare.get(l.bcItemNumber)
    nyePrVare.set(l.bcItemNumber, { qty: (cur?.qty ?? 0) + l.quantity, name: l.itemName || l.bcItemNumber })
  }
  if (nyePrVare.size) {
    try {
      const custLoc = await getCustomerLocationCode(maal.customerNo).catch(() => '')
      const cart: Record<string, number> = {}
      nyePrVare.forEach((v, k) => { cart[k] = v.qty })
      const cov = await getCartCoverage(
        maal.customerNo, custLoc, ymd(maal.deliveryDate), maal.shipmentMethodCode,
        Array.from(nyePrVare.keys()), cart,
      )
      const ikkeMere: string[] = []
      const forMeget: string[] = []
      const lofter: { itemNo: string; navn: string; maks: number }[] = []
      for (const row of cov?.results ?? []) {
        const ny = nyePrVare.get(row.itemNo)
        if (!ny || row.unlimited) continue
        const maks = Math.max(0, Math.round(row.maxQty * 10) / 10)
        if (maks <= 0) ikkeMere.push(ny.name)
        else if (ny.qty > maks) {
          forMeget.push(`${ny.name}: maks ${maks}`)
          lofter.push({ itemNo: row.itemNo, navn: ny.name, maks })
        }
      }
      if (ikkeMere.length || forMeget.length) {
        const dele = [
          ikkeMere.length ? `Ikke mere til denne leveringsdato: ${ikkeMere.join(', ')}` : '',
          forMeget.length ? `For stort antal — ${forMeget.join(', ')}` : '',
        ].filter(Boolean)
        return NextResponse.json({ error: `${dele.join('. ')}.`, lofter }, { status: 422 })
      }
    } catch (e) {
      console.error('[tilfoej] loft-tjek fejlede (fail-open):', e instanceof Error ? e.message : e)
    }
  }

  // BC er facit. Fejler den, skal der IKKE ligge linjer i portalens database som
  // kunden kan se men pakkeriet aldrig får — derfor skrives BC først.
  const { errors } = await addLinesToBCOrder(
    maal.bcOrderId,
    lines.map((l: any) => ({
      itemNumber: l.bcItemNumber,
      quantity:   l.quantity,
      uomCode:    l.uom,
    })),
  )
  if (errors.length > 0) {
    console.error('[tilfoej] BC afviste linjer paa', maal.bcOrderNumber, errors)
    return NextResponse.json(
      { error: `Varerne kunne ikke lægges på ordren: ${errors.join(' · ')}` },
      { status: 502 },
    )
  }

  // Portalens egen kopi — kun når ordren ER portalens. En ordre tastet i BC har ingen
  // række at hænge linjerne på, og den skal den heller ikke have: BC er kilden, og
  // ordreoversigten læser linjerne derfra.
  let gemt = 0
  if (maal.portalOrderId) {
    const created = await prisma.$transaction(
      lines.map((l: any) =>
        prisma.orderLine.create({
          data: {
            orderId:      maal.portalOrderId!,
            bcItemNumber: l.bcItemNumber,
            itemName:     l.itemName,
            quantity:     l.quantity,
            uom:          l.uom,
            unitPrice:    l.unitPrice ?? 0,
            status:       'PENDING',
          },
        }),
      ),
    )
    gemt = created.length
  }

  // Bust cachen for ordreoversigten (getPortalLineStatuses cacher BC-data i 30s) så de
  // tilføjede linjer vises med det samme — ellers krævede det en F5 fra kunden.
  revalidatePath('/portal/ordrer')
  revalidatePath(`/portal/ordrer/${params.id}`)

  return NextResponse.json({ added: gemt || lines.length }, { status: 201 })
}
