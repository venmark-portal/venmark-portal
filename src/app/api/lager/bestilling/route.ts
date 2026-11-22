import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { aabneBestillinger, sidsteSendte, startBestilling } from '@/lib/bestilling/bestilling'

export const runtime = 'nodejs'

// GET → de åbne kurve og de senest sendte.
// Alle brugeres åbne kurve, ikke kun ens egne: to mand i kølegangen skal kunne fylde
// den samme kurv, og den ene skal kunne se at den anden er i gang.
export async function GET(req: NextRequest) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const [aabne, sendte] = await Promise.all([aabneBestillinger(), sidsteSendte(10)])
  return NextResponse.json({ aabne, sendte })
}

// POST { locationCode? } → ny kurv.
export async function POST(req: NextRequest) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => null)
  const locationCode = String(body?.locationCode ?? bruger.lokation ?? '').trim().toUpperCase()

  const bestilling = await startBestilling(locationCode, bruger.id, bruger.navn)
  console.log(`[bestilling] ${bestilling.no} startet af ${bruger.navn} (${locationCode || 'ingen lokation'})`)
  return NextResponse.json(bestilling)
}
