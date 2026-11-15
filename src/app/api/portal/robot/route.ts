// Svar-robotten.
//   GET   → { aktiv, initiativ } for den indloggede kunde (chatboksen vises kun når aktiv)
//   POST  → { samtaleId, tekst } eller { samtaleId, start: true }; svaret streames som
//           server-sent events: {t:'tekst',v} bidder, {t:'vaerktoej',v} mens der slås op,
//           {t:'slut'} / {t:'fejl',v}
//   PATCH → { initiativ } kunden vælger selv om robotten starter samtalen
//
// Robotten er slået fra, indtil admin har sat kunden på under /admin/robot.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getActiveCustomerNo } from '@/lib/activeCustomer'
import { getPortalLang } from '@/lib/i18n/portal/server'
import { hentRobotStatus, saetRobotInitiativ, hentSamtale, logTur, spoergsmaalIDag } from '@/lib/robot/db'
import { RobotKontekst } from '@/lib/robot/kontekst'
import { koerSamtale, robotKonfigureret } from '@/lib/robot/motor'
import { START_INSTRUKS } from '@/lib/robot/prompt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAGSLOFT = Number(process.env.ROBOT_DAGSLOFT || 60)

async function kunde() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u || u.role !== 'customer' || !u.id) return null
  return {
    customerId: String(u.id),
    customerNo: getActiveCustomerNo(session),
    navn:       String(u.name ?? 'Kunde'),
    priceGrp:   String(u.bcPriceGroup ?? ''),
    chainGrp:   String(u.bcChainPriceGroup ?? ''),
    somAdmin:   u.impersonatedBy ? String(u.impersonatedBy) : null,
  }
}

export async function GET() {
  const k = await kunde()
  if (!k || !robotKonfigureret()) return NextResponse.json({ aktiv: false, initiativ: false })
  const s = await hentRobotStatus(k.customerId).catch(() => ({ aktiv: false, initiativ: false }))
  return NextResponse.json(s)
}

export async function PATCH(req: NextRequest) {
  const k = await kunde()
  if (!k) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (typeof body?.initiativ !== 'boolean') return NextResponse.json({ error: 'initiativ mangler' }, { status: 400 })
  await saetRobotInitiativ(k.customerId, body.initiativ)
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const k = await kunde()
  if (!k) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  if (!robotKonfigureret()) return NextResponse.json({ error: 'Robotten er ikke sat op' }, { status: 503 })
  const status = await hentRobotStatus(k.customerId)
  if (!status.aktiv) return NextResponse.json({ error: 'Robotten er ikke slået til' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const samtaleId = String(body?.samtaleId ?? '').slice(0, 64)
  const start = body?.start === true
  const tekst = start ? START_INSTRUKS : String(body?.tekst ?? '').trim().slice(0, 2000)
  if (!/^[A-Za-z0-9-]{8,64}$/.test(samtaleId) || !tekst) {
    return NextResponse.json({ error: 'Ugyldig forespørgsel' }, { status: 400 })
  }
  if (start && !status.initiativ) return NextResponse.json({ error: 'Initiativ er slået fra' }, { status: 400 })

  if ((await spoergsmaalIDag(k.customerId)) >= DAGSLOFT) {
    return NextResponse.json({ error: 'loft' }, { status: 429 })
  }

  const sprog = await getPortalLang()
  const ctx = new RobotKontekst({ ...k, sprog })
  const historik = start ? [] : await hentSamtale(k.customerId, samtaleId)
  await logTur({ customerId: k.customerId, samtaleId, rolle: 'kunde', tekst: start ? '[robotten startede samtalen]' : tekst, somAdmin: k.somAdmin })

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (t: string, v?: string) => controller.enqueue(enc.encode(`data: ${JSON.stringify({ t, v })}\n\n`))
      try {
        const r = await koerSamtale(historik, tekst, ctx, {
          tekst:     bid  => send('tekst', bid),
          vaerktoej: navn => send('vaerktoej', navn),
          ryd:       ()   => send('ryd'),
        })
        const svar = r.svar || 'Det kunne jeg ikke finde ud af lige nu. Prøv at spørge på en anden måde, eller skriv til os under Beskeder.'
        if (!r.svar) send('tekst', svar)
        await logTur({
          customerId: k.customerId, samtaleId, rolle: 'robot', tekst: svar, vaerktoejer: r.vaerktoejer.join(','),
          inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheTokens: r.cacheTokens, somAdmin: k.somAdmin,
        })
        send('slut')
      } catch (err: any) {
        console.error('[robot] samtale fejlede', err)
        await logTur({ customerId: k.customerId, samtaleId, rolle: 'fejl', tekst: String(err?.message ?? err).slice(0, 1000), somAdmin: k.somAdmin }).catch(() => {})
        send('fejl', 'Robotten kunne ikke svare lige nu. Prøv igen om lidt, eller skriv til os under Beskeder.')
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream; charset=utf-8',
      'Cache-Control':     'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
