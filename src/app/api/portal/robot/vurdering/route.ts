// Kundens 👍/👎 (og evt. kommentar) på et af robottens svar. Lander under /admin/robot.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { saetKundeVurdering } from '@/lib/robot/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u || u.role !== 'customer' || !u.id) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const id = Number(body?.id)
  const vurdering = body?.vurdering === 1 ? 1 : body?.vurdering === -1 ? -1 : 0
  if (!Number.isInteger(id) || id <= 0 || !vurdering) return NextResponse.json({ error: 'Ugyldig' }, { status: 400 })
  const kommentar = typeof body?.kommentar === 'string' && body.kommentar.trim() ? body.kommentar.trim().slice(0, 1000) : null
  const ok = await saetKundeVurdering(String(u.id), id, vurdering, kommentar)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Ikke fundet' }, { status: 404 })
}
