import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { hentOptaelling, saetBemaerkning } from '@/lib/lager/optaelling'

export const runtime = 'nodejs'

// POST { itemNo, remark } — bemærkning på en vare i optællingen.
// Følger med til kladdelinjen i BC sammen med ANSLÅET-mærket, så kontoret kan læse
// hvorfor et tal ser ud som det gør uden at ringe til den der talte.
// Maks 150 tegn: det er hvad der er plads til, og hvad nogen gider læse.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => null)
  const itemNo = String(body?.itemNo ?? '').trim().toUpperCase()
  const remark = String(body?.remark ?? '').trim().slice(0, 150)
  if (!itemNo) return NextResponse.json({ error: 'itemNo mangler' }, { status: 400 })

  const optaelling = await hentOptaelling(params.id)
  if (!optaelling) return NextResponse.json({ error: 'Optællingen findes ikke' }, { status: 404 })
  if (optaelling.status !== 'aaben') {
    return NextResponse.json({ error: `Optællingen er ${optaelling.status}` }, { status: 409 })
  }

  const ok = await saetBemaerkning(params.id, itemNo, remark)
  if (!ok) {
    return NextResponse.json(
      { error: 'Varen er ikke talt endnu — tæl den først, så kan du skrive en bemærkning' },
      { status: 400 },
    )
  }
  return NextResponse.json({ ok: true, remark })
}
