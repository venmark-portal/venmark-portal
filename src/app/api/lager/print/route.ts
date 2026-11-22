import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { gemValg, hentPrintere, hentValg, printLabels } from '@/lib/lager/print'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: printerne BC kender, og den brugeren sidst valgte.
export async function GET(req: NextRequest) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const [printere, valg] = await Promise.all([hentPrintere(), hentValg(bruger.id)])
  return NextResponse.json({ printere, valg })
}

// PUT { printerId, printerNavn } → husk brugerens printer.
//
// Valget bor her og ikke i BC, fordi alle terminaler kalder BC ind som OAuth-appen:
// BC's eget "min printer" pr. bruger ville ramme appen og ikke manden med terminalen.
export async function PUT(req: NextRequest) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => null)
  const printerId = String(body?.printerId ?? '').trim()
  if (!printerId) return NextResponse.json({ error: 'printerId mangler' }, { status: 400 })

  // Printeren skal findes i BC. Ellers kunne man gemme et navn, der gav et print,
  // som forsvinder: BC siger ja, og papiret kommer aldrig.
  const printere = await hentPrintere()
  const fundet = printere.find(p => p.id === printerId)
  if (!fundet) return NextResponse.json({ error: 'BC kender ikke den printer' }, { status: 409 })

  await gemValg(bruger.id, fundet.id, fundet.navn)
  console.log(`[lager print] ${bruger.navn} valgte printer ${fundet.navn}`)
  return NextResponse.json({ valg: { printerId: fundet.id, printerNavn: fundet.navn } })
}

// POST { itemNos: string[], antal?, printerId? } → print labels.
export async function POST(req: NextRequest) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => null)
  const itemNos: string[] = Array.isArray(body?.itemNos)
    ? body.itemNos.map((n: unknown) => String(n).trim().toUpperCase()).filter(Boolean)
    : []
  if (itemNos.length === 0) return NextResponse.json({ error: 'Ingen varer at printe' }, { status: 400 })

  const antal = Number.isFinite(Number(body?.antal)) && Number(body.antal) > 0 ? Number(body.antal) : 1

  // Printeren kan sendes med, men normalt er det den brugeren har valgt.
  let printerId = String(body?.printerId ?? '').trim()
  if (!printerId) {
    const valg = await hentValg(bruger.id)
    if (!valg) {
      return NextResponse.json(
        { error: 'Vælg først en printer', vaelgPrinter: true },
        { status: 409 },
      )
    }
    printerId = valg.printerId
  }

  const svar = await printLabels(itemNos, antal, printerId, bruger.navn)
  if (!svar) return NextResponse.json({ error: 'BC svarede ikke', offline: true }, { status: 502 })
  // 409 og ikke 500: en ukendt vare eller en printer, der er forsvundet fra PrintNode,
  // er en besked til lagermanden — ikke en fejl han skal ringe om.
  if (!svar.ok) return NextResponse.json({ error: svar.fejl ?? 'Der blev ikke printet noget' }, { status: 409 })
  return NextResponse.json(svar)
}
