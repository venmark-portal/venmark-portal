import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { hentOptaelling } from '@/lib/lager/optaelling'
import { accepterForslag, afvisForslag, forslagForOptaelling } from '@/lib/lager/bestillingsforslag'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: hvad der bør bestilles efter det der er talt indtil nu, og hvad der allerede
// ligger i kurven.
//
// Listen virker OGSÅ efter at optællingen er sendt til BC. Det er med vilje: tællingen
// er færdig, men indkøbet er det ikke, og kontoret skal kunne åbne den færdige
// optælling og bestille derfra. Kurven er et selvstændigt dokument.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const optaelling = await hentOptaelling(params.id)
  if (!optaelling) return NextResponse.json({ error: 'Findes ikke' }, { status: 404 })

  return NextResponse.json(await forslagForOptaelling(params.id))
}

// POST { itemNo, antal? } → læg ét forslag i kurven
// POST { alle: true }     → læg alle forslag i kurven der ikke ligger der endnu
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const optaelling = await hentOptaelling(params.id)
  if (!optaelling) return NextResponse.json({ error: 'Optællingen findes ikke' }, { status: 404 })

  const body = await req.json().catch(() => null)

  if (body?.alle) {
    const t0 = Date.now()
    const { forslag } = await forslagForOptaelling(params.id)
    const mangler = forslag.filter(f => f.iKurv === null)
    let lagt = 0
    const fejl: string[] = []
    // Ét BC-opslag pr. vare. Det tager et sekund for en håndfuld varer, og det er
    // prisen for at leverandør og enhed er de aktuelle, når linjen laves.
    for (const f of mangler) {
      const svar = await accepterForslag(params.id, f.itemNo, bruger.id, bruger.navn)
      if (svar.ok) lagt += 1
      else fejl.push(`${f.itemNo}: ${svar.fejl}`)
    }
    const kurv = await forslagForOptaelling(params.id)
    console.log(
      `[lager forslag] ${optaelling.no}: ${lagt}/${mangler.length} lagt i kurven ` +
      `${kurv.bestillingNo ?? '-'} af ${bruger.navn} (${Date.now() - t0} ms)` +
      (fejl.length ? ` — fejlede: ${fejl.join('; ')}` : ''),
    )
    return NextResponse.json({
      ok: fejl.length === 0,
      lagt,
      fejlede: fejl.length,
      fejl: fejl.length ? fejl.join('; ') : undefined,
      bestillingId: kurv.bestillingId,
      bestillingNo: kurv.bestillingNo,
    })
  }

  const itemNo = String(body?.itemNo ?? '').trim().toUpperCase()
  if (!itemNo) return NextResponse.json({ error: 'itemNo mangler' }, { status: 400 })
  const antal = body?.antal === undefined || body?.antal === null ? undefined : Number(body.antal)
  if (antal !== undefined && !Number.isFinite(antal)) {
    return NextResponse.json({ error: 'antal er ikke et tal' }, { status: 400 })
  }

  const svar = await accepterForslag(params.id, itemNo, bruger.id, bruger.navn, antal)
  if (!svar.ok) return NextResponse.json({ error: svar.fejl }, { status: 409 })
  console.log(
    `[lager forslag] ${optaelling.no}: ${itemNo} × ${svar.qty} i kurven ${svar.bestillingNo} af ${bruger.navn}`,
  )
  return NextResponse.json(svar)
}

// DELETE ?itemNo=... — tag varen ud af kurven igen.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const itemNo = (req.nextUrl.searchParams.get('itemNo') ?? '').trim().toUpperCase()
  if (!itemNo) return NextResponse.json({ error: 'itemNo mangler' }, { status: 400 })

  const fjernet = await afvisForslag(params.id, itemNo)
  // 409 og ikke 404: varen findes, men kurven er sendt — og sendt er sendt.
  if (!fjernet) {
    return NextResponse.json(
      { error: 'Varen kunne ikke tages ud — er kurven sendt til BC?' },
      { status: 409 },
    )
  }
  return NextResponse.json({ fjernet })
}
