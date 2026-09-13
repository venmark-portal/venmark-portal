// Kopierer Teams-opkald (Direct Routing) fra Graph ind i vores egen tabel.
//
// Hvorfor kopiere: Microsoft gemmer KUN Direct Routing-data i 150 dage. Henter man
// live, ruller historikken væk bagfra hver dag. Med kopien samler statistikken sig
// fremad for altid.
//
// Køres hver time fra crontab. Den henter 3 dage tilbage hver gang — ikke kun i
// dag — fordi Graph kan være et stykke bagud med at få opkald ind i loggen, og
// fordi et par tabte cron-kørsler så samler sig selv op. Gentagelser er gratis:
// rækker sættes ind på Graphs eget opkalds-id med ON CONFLICT DO NOTHING.
//
// Engangs-tilbagehentning (fx hele perioden siden juni):
//   curl -X POST .../api/cron/telefoni?fra=2026-06-01 -H "x-cron-secret: ..."

import { NextRequest, NextResponse } from 'next/server'
import { synkTelefoni, berigVentetid, TilladelseMangler } from '@/lib/telefoni'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const fraParam = req.nextUrl.searchParams.get('fra')
  const til = new Date()
  const fra = fraParam
    ? new Date(`${fraParam}T00:00:00Z`)
    : new Date(til.getTime() - 3 * 864e5)

  if (isNaN(fra.getTime())) {
    return NextResponse.json({ ok: false, error: 'fra skal være YYYY-MM-DD' }, { status: 400 })
  }

  // Hvor mange hovednummer-opkald der beriges med rigtig svartid pr. kørsel.
  // Ét Graph-kald pr. opkald, så loftet holder en time-kørsel kort — men det er
  // rigeligt til ~100 opkald om dagen, og resten tages næste time.
  const berig = Number(req.nextUrl.searchParams.get('berig') ?? 400)

  try {
    const res = await synkTelefoni(fra, til)
    // Trunk-loggen ved kun at omstillingen svarede efter ~1 sek. Den rigtige
    // ventetid — og hvem der tog den — hentes her.
    const v = await berigVentetid(berig)
    console.log(`[telefoni] ${fra.toISOString().slice(0, 10)} → ${til.toISOString().slice(0, 10)}: ` +
                `${res.hentet} opkald · ${v.beriget} beriget · ${v.ubesvarede} ubesvarede`)
    return NextResponse.json({ ok: true, fra: fra.toISOString(), til: til.toISOString(), ...res, ventetid: v })
  } catch (err) {
    const besked = err instanceof Error ? err.message : String(err)
    // Manglende tilladelse er en opsætningsfejl, ikke et nedbrud — og et Graph-udfald
    // må ikke give en rød cron-mail hver time. Log og svar pænt.
    if (err instanceof TilladelseMangler) {
      console.warn('[telefoni] tilladelse mangler:', besked)
    } else {
      console.error('[telefoni] fejl:', besked)
    }
    return NextResponse.json({ ok: false, error: besked }, { status: 200 })
  }
}
