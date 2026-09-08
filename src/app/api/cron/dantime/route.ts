// Sampler Dan-Times situationsrapport. Køres hyppigt fra crontab (hvert 2. minut).
//
// Hvorfor så tit: rapporten viser kun det seneste stempel pr. medarbejder, og
// jobnummeret forsvinder når personen stempler ud. Sampler vi ikke løbende, kan
// vi aldrig bagefter svare på hvem der var på en linje da produktionen blev
// afsluttet. Sample-intervallet er præcisionen på det svar.

import { NextRequest, NextResponse } from 'next/server'
import { hentSituationsrapport, ingestDanTime } from '@/lib/dantime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function koer() {
  const raekker = await hentSituationsrapport()
  const res = await ingestDanTime(raekker)
  const inde = raekker.filter(r => !r.ud).length
  console.log(`[dantime] ${res.hentet} rækker · ${res.nye} nye · ${inde} stemplet ind`)
  return NextResponse.json({ ok: true, ...res, inde })
}

export async function POST(req: NextRequest) {
  if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  try {
    return await koer()
  } catch (err) {
    // Dan-Time nede må ikke give en rød cron-mail hver gang — log og svar pænt.
    const besked = err instanceof Error ? err.message : String(err)
    console.error('[dantime] fejl:', besked)
    return NextResponse.json({ ok: false, error: besked }, { status: 200 })
  }
}
