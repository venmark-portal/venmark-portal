import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { alleAabneSignaler, markerBestilt } from '@/lib/kanban'

export const runtime = 'nodejs'

// GET → alle åbne "tom hylde"-meldinger, ældste først.
//
// Her er INGEN 90000-grænse, modsat salgsskærmen. Det er hele pointen: kanban-kortene
// bruges mest over 90000 — emballage, rengøring, reservedele — og netop de meldinger er
// indkøberens. Uden denne liste blev de meldt og aldrig set af nogen.
export async function GET(req: NextRequest) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  return NextResponse.json({ signaler: await alleAabneSignaler(50) })
}

// POST { itemNo } → lukker meldingen, fordi varen nu er i en bestilling.
// Appen kalder den efter at varen er lagt i kurven: en melding skal forsvinde fra
// listen, når der er handlet på den, ellers bestiller to mand den samme vare.
export async function POST(req: NextRequest) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => null)
  const itemNo = String(body?.itemNo ?? '').trim().toUpperCase()
  if (!itemNo) return NextResponse.json({ error: 'itemNo mangler' }, { status: 400 })

  const lukkede = await markerBestilt(itemNo, bruger.navn)
  return NextResponse.json({ lukkede })
}
