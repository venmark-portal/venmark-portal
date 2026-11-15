import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { sendOptaelling } from '@/lib/lager/optaelling'

export const runtime = 'nodejs'

// POST → sender tællingen til BC og beder BC skrive lageropgørelseskladden.
// Der BOGFØRES ikke. Et menneske bogfører kladden i BC — bevidst, fordi det også er
// et menneske der i dag retter en optælling der ser forkert ud.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const t0 = Date.now()
  const svar = await sendOptaelling(params.id)
  console.log(
    `[lager optaelling] send ${params.id}: ${svar.ok ? `${svar.linjer} linjer, ${svar.afvigelser} afvigelser` : 'FEJL ' + svar.fejl} (${Date.now() - t0} ms)`,
  )
  return NextResponse.json(svar, { status: svar.ok ? 200 : 400 })
}
