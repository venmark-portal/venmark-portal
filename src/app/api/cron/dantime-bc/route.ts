// Synkroniserer mod BC: joblisten op, og medarbejdere på afsluttede produktioner
// ned. Kører hvert 10. minut — adskilt fra /api/cron/dantime med vilje.
//
// Samplingen skal være LET og aldrig fejle: stemplinger kan ikke hentes igen
// bagefter, når først folk er stemplet ud. BC-arbejdet her kan derimod altid køres
// om, fordi intervallerne allerede ligger i vores egen database.

import { NextRequest, NextResponse } from 'next/server'
import { fangMedarbejdere, synkJobsTilBC } from '@/lib/dantime-bc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // De to opgaver er uafhængige — den ene må ikke kunne spærre den anden.
  let jobs: unknown = null, fanget: unknown = null
  const fejl: string[] = []

  try { jobs = await synkJobsTilBC() }
  catch (e) { const m = e instanceof Error ? e.message : String(e); fejl.push(`job-synk: ${m}`); console.error('[dantime-bc]', m) }

  try { fanget = await fangMedarbejdere() }
  catch (e) { const m = e instanceof Error ? e.message : String(e); fejl.push(`medarbejdere: ${m}`); console.error('[dantime-bc]', m) }

  console.log('[dantime-bc]', JSON.stringify({ jobs, fanget, fejl }))
  return NextResponse.json({ ok: fejl.length === 0, jobs, fanget, fejl }, { status: 200 })
}
