// Medarbejder-kartoteket. Navn og lønnummer kommer fra Dan-Time og opdateres af
// samplingen; initialerne sættes her, fordi fulde navne er for lange på en skærm.

import { NextRequest, NextResponse } from 'next/server'
import { afvis, erSuperadmin, signageBruger } from '@/lib/signage/guard'
import { listMedarbejdere, saetInitialer, saetPakkerKode } from '@/lib/dantime'
import { brugtePakkerKoder } from '@/lib/pakkeri'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const b = await signageBruger()
  if (!b) return afvis()
  // Koderne BC faktisk har brugt sendes med, så admin kan vælge fra en liste i
  // stedet for at skulle stave "5CHRISTIAN" rigtigt i hånden.
  const [medarbejdere, koder] = await Promise.all([
    listMedarbejdere(),
    brugtePakkerKoder(90).catch(() => [] as string[]),
  ])
  return NextResponse.json({ medarbejdere, pakkerKoder: koder })
}

export async function PATCH(req: NextRequest) {
  const b = await signageBruger()
  if (!b) return afvis()
  if (!erSuperadmin(b)) return NextResponse.json({ error: 'Kun superadmin' }, { status: 403 })

  const body  = await req.json().catch(() => ({}))
  const lonnr = String(body.lonnr ?? '').trim()
  if (!lonnr) return NextResponse.json({ error: 'Lønnr. mangler' }, { status: 400 })

  // Pakkerkoden sættes for sig — den må gerne ryddes (tom streng), mens
  // initialer aldrig må blive tomme.
  if (body.pakkerKode !== undefined) {
    await saetPakkerKode(lonnr, String(body.pakkerKode ?? ''))
    return NextResponse.json({ ok: true })
  }

  const initialer = String(body.initialer ?? '').trim()
  if (!initialer) return NextResponse.json({ error: 'Initialer må ikke være tomme' }, { status: 400 })
  await saetInitialer(lonnr, initialer)
  return NextResponse.json({ ok: true })
}
