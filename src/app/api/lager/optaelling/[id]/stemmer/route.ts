import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { bekraeftVare, hentOptaelling } from '@/lib/lager/optaelling'
import { gemIdempotentSvar, hentIdempotentSvar } from '@/lib/lager/db'

export const runtime = 'nodejs'

// POST { itemNo, idempotencyKey? } — "Stemmer": godkend BC's tal uden at tælle.
// Gemmes som BEKRÆFTET, ikke talt, så man bagefter kan se forskel på at nogen har
// set efter, og at nogen har trykket videre.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => null)
  const itemNo = String(body?.itemNo ?? '').trim().toUpperCase()
  const key = String(body?.idempotencyKey ?? '').trim()
  if (!itemNo) return NextResponse.json({ error: 'itemNo mangler' }, { status: 400 })

  const tidligere = await hentIdempotentSvar(key)
  if (tidligere) return NextResponse.json(tidligere)

  const optaelling = await hentOptaelling(params.id)
  if (!optaelling) return NextResponse.json({ error: 'Optællingen findes ikke' }, { status: 404 })
  if (optaelling.status !== 'aaben') {
    return NextResponse.json({ error: `Optællingen er ${optaelling.status}` }, { status: 409 })
  }

  const svar = await bekraeftVare(params.id, itemNo, optaelling.locationCode, bruger.navn)
  if (!svar.ok) return NextResponse.json(svar, { status: 400 })

  await gemIdempotentSvar(key, 'optaelling-stemmer', bruger.id, svar)
  return NextResponse.json(svar)
}
