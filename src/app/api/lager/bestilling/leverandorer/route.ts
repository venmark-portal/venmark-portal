import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { soegLeverandoerer } from '@/lib/bestilling/bc'

export const runtime = 'nodejs'

// GET ?q=... → leverandørsøgning i BC.
//
// Bruges KUN når varen ikke har en leverandør på varekortet. Uden den ville
// lagermanden stå med en kurv BC afviser, og ingen vej videre end at ringe til kontoret.
export async function GET(req: NextRequest) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ leverandoerer: [] })

  return NextResponse.json({ leverandoerer: await soegLeverandoerer(q) })
}
