// Lægger bogførte fakturalinjer sammen til én række pr. dag i "SalgDag".
//
// Hvorfor aggregere: ledelsestavlen sammenligner med samme dag sidste år, og
// der ligger ~100.000 fakturalinjer i to år. At hente dem ved hvert sideopslag
// ville gøre tavlen ubrugelig.
//
// Køres om natten. Den tager 10 dage tilbage hver gang — ikke kun i går — fordi
// en faktura kan bogføres med tilbagevirkende dato, og fordi en tabt kørsel så
// samler sig selv op. Gentagelser er gratis: dagene skrives forfra.
//
// Engangs-tilbagehentning af hele historikken:
//   curl -X POST .../api/cron/salgdage?fra=2025-01-01 -H "x-cron-secret: ..."

import { NextRequest, NextResponse } from 'next/server'
import { synkSalgDage, synkLukkedage } from '@/lib/tidslinjer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 600

function dagStreng(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(d)
}

export async function POST(req: NextRequest) {
  if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const nu  = new Date()
  const til = dagStreng(nu)
  const fra = req.nextUrl.searchParams.get('fra') ?? dagStreng(new Date(nu.getTime() - 10 * 864e5))

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fra)) {
    return NextResponse.json({ ok: false, error: 'fra skal være YYYY-MM-DD' }, { status: 400 })
  }

  try {
    const salg = await synkSalgDage(fra, til)
    // Lukkedage hentes et år frem OG tilbage, så både i dag og sammenlignings-
    // dagen sidste år kan markeres.
    const lukke = await synkLukkedage(
      dagStreng(new Date(nu.getTime() - 400 * 864e5)),
      dagStreng(new Date(nu.getTime() + 200 * 864e5)),
    ).catch(() => 0)

    console.log(`[salgdage] ${fra} → ${til}: ${salg.dage} dage af ${salg.linjer} linjer · ${lukke} lukkedage`)
    return NextResponse.json({ ok: true, fra, til, ...salg, lukkedage: lukke })
  } catch (err) {
    const besked = err instanceof Error ? err.message : String(err)
    console.error('[salgdage] fejl:', besked)
    // Et BC-udfald må ikke give en rød cron-mail hver nat — log og svar pænt.
    return NextResponse.json({ ok: false, error: besked }, { status: 200 })
  }
}
