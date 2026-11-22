import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import {
  grupperPrLeverandoer, hentBestilling, hentLinjer, saetOrdreBemaerkning,
} from '@/lib/bestilling/bestilling'

export const runtime = 'nodejs'

// GET → kurven med linjerne, delt op pr. leverandør.
// Opdelingen laves HER og ikke i skærmen: det er det samme snit BC laver, og
// lagermanden skal kunne se hvor mange købsordrer det bliver, før han sender.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const bestilling = await hentBestilling(params.id)
  if (!bestilling) return NextResponse.json({ error: 'Bestillingen findes ikke' }, { status: 404 })

  const linjer = await hentLinjer(params.id)
  return NextResponse.json({
    bestilling,
    linjer,
    grupper: grupperPrLeverandoer(linjer),
    antalLinjer: linjer.length,
    udenLeverandoer: linjer.filter(l => !l.vendorNo).length,
  })
}

// PATCH { note } → bemærkning på hele bestillingen.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const bestilling = await hentBestilling(params.id)
  if (!bestilling) return NextResponse.json({ error: 'Bestillingen findes ikke' }, { status: 404 })
  if (bestilling.status !== 'aaben') {
    return NextResponse.json({ error: `Bestillingen er ${bestilling.status} og kan ikke ændres` }, { status: 409 })
  }

  const body = await req.json().catch(() => null)
  const gemt = await saetOrdreBemaerkning(params.id, String(body?.note ?? ''))
  return NextResponse.json({ gemt })
}
