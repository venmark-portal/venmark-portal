import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { aabneOptaellinger, startOptaelling } from '@/lib/lager/optaelling'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: de åbne optællinger. Flere kan tælle på den samme — derfor en liste og ikke
// "min igangværende": to mand på hver sin hylde skal lægge i samme tælling.
export async function GET(req: NextRequest) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })
  return NextResponse.json(await aabneOptaellinger())
}

// POST { locationCode } → ny optælling
export async function POST(req: NextRequest) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })
  if (!bruger.maaTaelle) return NextResponse.json({ error: 'Du må ikke lave optælling' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const lokation = String(body?.locationCode ?? bruger.lokation ?? '').trim().toUpperCase()
  if (!lokation) return NextResponse.json({ error: 'Vælg en lokation' }, { status: 400 })

  // Blind tælling er et valg, ikke en regel: det meste stemmer, og så er det
  // hurtigere at se forskellen med det samme.
  const optaelling = await startOptaelling(lokation, bruger.id, bruger.navn, !!body?.blind)
  console.log(
    `[lager optaelling] ${optaelling.no} startet på ${lokation} af ${bruger.navn}${optaelling.blind ? ' (blind)' : ''}`,
  )
  return NextResponse.json(optaelling)
}
