import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { gemIdempotentSvar, hentIdempotentSvar } from '@/lib/lager/db'
import {
  fjernLinje, hentBestilling, saetAntal, saetBemaerkning, saetLeverandoer, scanTilKurv,
} from '@/lib/bestilling/bestilling'

export const runtime = 'nodejs'

/** Kurven må kun røres mens den er åben. Er den sendt, kan den ikke fyldes på. */
async function aabenKurv(id: string) {
  const bestilling = await hentBestilling(id)
  if (!bestilling) return { fejl: NextResponse.json({ error: 'Bestillingen findes ikke' }, { status: 404 }) }
  if (bestilling.status !== 'aaben') {
    return {
      fejl: NextResponse.json(
        {
          error:
            `Bestillingen er sendt til BC og kan ikke fyldes på. ` +
            `Start en ny bestilling — eller ret købsordren${bestilling.bcOrderNos ? ` ${bestilling.bcOrderNos}` : ''} i BC.`,
        },
        { status: 409 },
      ),
    }
  }
  return { bestilling }
}

// POST { kode, antal?, saet?, idempotencyKey? }
// Scanner eller taster en vare i kurven. Antallet er appens forslag (ordrekvantum),
// med mindre der sendes et antal med. `saet` SÆTTER i stedet for at lægge til.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => null)
  const kode = String(body?.kode ?? '').trim()
  if (!kode) return NextResponse.json({ error: 'kode mangler' }, { status: 400 })

  const key = String(body?.idempotencyKey ?? '').trim()
  // Samme nøgle to gange = samme scanning sendt igen. Svar det samme, læg ikke til igen.
  const tidligere = await hentIdempotentSvar(key)
  if (tidligere) return NextResponse.json(tidligere)

  const { fejl } = await aabenKurv(params.id)
  if (fejl) return fejl

  const antal = body?.antal === undefined || body?.antal === null ? undefined : Number(body.antal)
  if (antal !== undefined && !Number.isFinite(antal)) {
    return NextResponse.json({ error: 'antal er ikke et tal' }, { status: 400 })
  }

  const t0 = Date.now()
  const svar = await scanTilKurv(params.id, kode, bruger.lokation ?? '', bruger.navn, {
    antal,
    saet: !!body?.saet,
  })
  console.log(
    `[bestilling scan] ${kode} → ${svar?.opslag.itemNo || (svar ? 'ukendt' : 'BC-FEJL')} (${Date.now() - t0} ms)`,
  )

  if (!svar) {
    return NextResponse.json({ error: 'BC svarede ikke', offline: true }, { status: 502 })
  }
  if (!svar.opslag.found) {
    // Ukendt kode er IKKE en fejl: appen skal kunne tilbyde at søge varen frem i
    // stedet for at vise en rød fejl til en lagermand med handsker på.
    return NextResponse.json({ found: false, opslag: svar.opslag })
  }

  const resultat = { found: true, opslag: svar.opslag, linje: svar.linje }
  await gemIdempotentSvar(key, 'bestilling-linje', bruger.id, resultat)
  return NextResponse.json(resultat)
}

// PATCH { itemNo, antal? , bemaerkning?, vendorNo?, vendorName? }
// Retter en linje der allerede ligger i kurven.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const { fejl } = await aabenKurv(params.id)
  if (fejl) return fejl

  const body = await req.json().catch(() => null)
  const itemNo = String(body?.itemNo ?? '').trim().toUpperCase()
  if (!itemNo) return NextResponse.json({ error: 'itemNo mangler' }, { status: 400 })

  let gemt = false
  if (body?.antal !== undefined && body?.antal !== null) {
    const antal = Number(body.antal)
    if (!Number.isFinite(antal)) return NextResponse.json({ error: 'antal er ikke et tal' }, { status: 400 })
    // 0 fjerner linjen. Det er den eneste måde at "slette" på et taltastatur uden
    // at skulle finde en ekstra knap med en handske på.
    gemt = await saetAntal(params.id, itemNo, antal)
  }
  if (body?.bemaerkning !== undefined) {
    gemt = (await saetBemaerkning(params.id, itemNo, String(body.bemaerkning))) || gemt
  }
  if (body?.vendorNo !== undefined) {
    gemt =
      (await saetLeverandoer(params.id, itemNo, String(body.vendorNo).toUpperCase(), String(body?.vendorName ?? ''))) ||
      gemt
  }

  return NextResponse.json({ gemt })
}

// DELETE ?itemNo=... — tager varen ud af kurven.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const { fejl } = await aabenKurv(params.id)
  if (fejl) return fejl

  const itemNo = (req.nextUrl.searchParams.get('itemNo') ?? '').trim().toUpperCase()
  if (!itemNo) return NextResponse.json({ error: 'itemNo mangler' }, { status: 400 })

  const fjernet = await fjernLinje(params.id, itemNo)
  return NextResponse.json({ fjernet })
}
