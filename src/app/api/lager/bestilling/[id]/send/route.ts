import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { sendBestilling } from '@/lib/bestilling/bestilling'

export const runtime = 'nodejs'

// POST → sender kurven til BC, som laver én ÅBEN købsordre pr. leverandør.
//
// Der SENDES IKKE til leverandøren. Ordrerne ligger åbne i BC og skal godkendes og
// sendes som altid — det var hele betingelsen for at scanne direkte ind i en købsordre.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const t0 = Date.now()
  const svar = await sendBestilling(params.id)
  console.log(
    `[bestilling send] ${params.id} → ${svar.ok ? `${svar.ordrer} ordre(r): ${svar.ordreNumre}` : `FEJL: ${svar.fejl}`}` +
      ` (${Date.now() - t0} ms)`,
  )

  if (!svar.ok) {
    // 409 og ikke 500: det er næsten altid en afvisning BC har en grund til — en vare
    // uden leverandør, en spærret leverandør — og den grund skal lagermanden læse.
    return NextResponse.json({ error: svar.fejl }, { status: 409 })
  }
  return NextResponse.json(svar)
}
