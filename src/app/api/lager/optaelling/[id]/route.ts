import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { hentOptaelling, summerPrVare } from '@/lib/lager/optaelling'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: optællingen og hvad der er talt indtil nu, summeret pr. vare — med BC's tal
// og afvigelsen pr. vare. Er optællingen markeret blind, kommer BC-tallene ikke med.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const optaelling = await hentOptaelling(params.id)
  if (!optaelling) return NextResponse.json({ error: 'Findes ikke' }, { status: 404 })

  return NextResponse.json({ optaelling, varer: await summerPrVare(params.id, optaelling.blind) })
}
