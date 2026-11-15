import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { hentOptaelling, tjekVare } from '@/lib/lager/optaelling'

export const runtime = 'nodejs'

// POST { itemNo } → { stemmer, talt, kunneTjekkes, bcAntal?, afvigelse? }
//
// Kaldes når optælleren er færdig med en vare. Normalt kommer BC's tal og afvigelsen
// med, så man kan se HVOR meget der mangler og straks afgøre om det er en tælefejl.
// Er optællingen markeret blind, svarer vi kun stemmer/stemmer ikke.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => null)
  const itemNo = String(body?.itemNo ?? '').trim().toUpperCase()
  if (!itemNo) return NextResponse.json({ error: 'itemNo mangler' }, { status: 400 })

  const optaelling = await hentOptaelling(params.id)
  if (!optaelling) return NextResponse.json({ error: 'Optællingen findes ikke' }, { status: 404 })

  const svar = await tjekVare(params.id, itemNo, optaelling.locationCode, optaelling.blind)
  console.log(
    `[lager optaelling] ${optaelling.no} tjek ${itemNo}: ${svar.kunneTjekkes ? (svar.stemmer ? 'stemmer' : 'AFVIGER') : 'kunne ikke tjekkes'}`,
  )
  return NextResponse.json(svar)
}
