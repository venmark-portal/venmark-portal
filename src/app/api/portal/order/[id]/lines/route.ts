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
import { addLinesToBCOrder } from '@/lib/businesscentral'
import { findTilfoejMaal } from '@/lib/tilfoejOrdre'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const maal = await findTilfoejMaal(params.id, session)
  if (!maal) {
    return NextResponse.json({ error: 'Ordren blev ikke fundet' }, { status: 404 })
  }
  if (new Date() > maal.deadline) {
    return NextResponse.json({ error: 'Fristen for denne leveringsdato er passeret' }, { status: 422 })
  }

  const { lines } = await req.json()
  if (!lines?.length) {
    return NextResponse.json({ error: 'Ingen linjer' }, { status: 400 })
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
