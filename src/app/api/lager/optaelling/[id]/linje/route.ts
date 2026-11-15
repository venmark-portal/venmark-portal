import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { fortrydSidste, hentOptaelling, kasseAlleredeTalt, tilfoejLinje } from '@/lib/lager/optaelling'
import { gemIdempotentSvar, hentIdempotentSvar } from '@/lib/lager/db'

export const runtime = 'nodejs'

// POST { itemNo, qty, uom?, estimated?, shelfCode?, lotNo?, barcode?, idempotencyKey? }
// Gemmer én registrering. Svaret er varens løbende total PÅ DENNE TÆLLING — aldrig
// BC's tal, for tællingen er blind.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => null)
  const itemNo = String(body?.itemNo ?? '').trim().toUpperCase()
  const qty = Number(body?.qty)
  const key = String(body?.idempotencyKey ?? '').trim()
  if (!itemNo) return NextResponse.json({ error: 'itemNo mangler' }, { status: 400 })
  if (!Number.isFinite(qty)) return NextResponse.json({ error: 'qty er ikke et tal' }, { status: 400 })

  // Samme nøgle to gange = samme scanning sendt igen. Svar det samme, tæl ikke igen.
  const tidligere = await hentIdempotentSvar(key)
  if (tidligere) return NextResponse.json(tidligere)

  const optaelling = await hentOptaelling(params.id)
  if (!optaelling) return NextResponse.json({ error: 'Optællingen findes ikke' }, { status: 404 })
  if (optaelling.status !== 'aaben') {
    return NextResponse.json({ error: `Optællingen er ${optaelling.status} og kan ikke ændres` }, { status: 409 })
  }

  // En kasse- eller lot-kode sidder på ÉN fysisk kasse. Scannes den igen, er det en
  // fejl og ikke en kasse mere — og det er værnet mod at både en samlekasse og dens
  // indhold ender i tællingen og giver dobbelt vægt.
  const barcode = String(body?.barcode ?? '').trim()
  if (body?.unikKasse && (await kasseAlleredeTalt(params.id, barcode))) {
    return NextResponse.json(
      { error: 'Kassen er allerede talt på denne optælling', allerede: true },
      { status: 409 },
    )
  }

  const svar = await tilfoejLinje(
    params.id,
    {
      itemNo,
      description: String(body?.description ?? ''),
      qty,
      uom: String(body?.uom ?? ''),
      estimated: !!body?.estimated,
      shelfCode: body?.shelfCode ? String(body.shelfCode) : undefined,
      lotNo: body?.lotNo ? String(body.lotNo) : undefined,
      barcode: body?.barcode ? String(body.barcode) : undefined,
      // BC's beholdning kom med fra opslaget — gem den, så oversigten kan vise
      // afvigelsen uden et nyt BC-kald pr. vare.
      bcQty: Number.isFinite(Number(body?.bcQty)) ? Number(body.bcQty) : null,
    },
    bruger.navn,
  )

  await gemIdempotentSvar(key, 'optaelling-linje', bruger.id, svar)
  return NextResponse.json(svar)
}

// DELETE ?itemNo=... — fortryd den seneste registrering på varen.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const itemNo = (req.nextUrl.searchParams.get('itemNo') ?? '').trim().toUpperCase()
  if (!itemNo) return NextResponse.json({ error: 'itemNo mangler' }, { status: 400 })

  const optaelling = await hentOptaelling(params.id)
  if (!optaelling || optaelling.status !== 'aaben') {
    return NextResponse.json({ error: 'Optællingen kan ikke ændres' }, { status: 409 })
  }

  const fjernet = await fortrydSidste(params.id, itemNo)
  return NextResponse.json({ fjernet })
}
