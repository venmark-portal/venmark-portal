// Medarbejder-kartoteket. Navn og lønnummer kommer fra Dan-Time og opdateres af
// samplingen; initialerne sættes her, fordi fulde navne er for lange på en skærm.

import { NextRequest, NextResponse } from 'next/server'
import { afvis, erSuperadmin, signageBruger } from '@/lib/signage/guard'
import { listMedarbejdere, saetInitialer } from '@/lib/dantime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const b = await signageBruger()
  if (!b) return afvis()
  return NextResponse.json(await listMedarbejdere())
}

export async function PATCH(req: NextRequest) {
  const b = await signageBruger()
  if (!b) return afvis()
  if (!erSuperadmin(b)) return NextResponse.json({ error: 'Kun superadmin' }, { status: 403 })

  const body      = await req.json().catch(() => ({}))
  const lonnr     = String(body.lonnr ?? '').trim()
  const initialer = String(body.initialer ?? '').trim()
  if (!lonnr)     return NextResponse.json({ error: 'Lønnr. mangler' }, { status: 400 })
  if (!initialer) return NextResponse.json({ error: 'Initialer må ikke være tomme' }, { status: 400 })

  await saetInitialer(lonnr, initialer)
  return NextResponse.json({ ok: true })
}
