// Hvem må røre hvilke skærme. Kun superadmin (ubegrænset portal-admin) må se
// eller ændre tildelingerne.

import { NextRequest, NextResponse } from 'next/server'
import { afvis, erSuperadmin, signageBruger } from '@/lib/signage/guard'
import {
  grantAccess, listAccess, listAdminUsers, revokeAccess, setSignageLimited,
  type SignageRole,
} from '@/lib/signage/screens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLLER: SignageRole[] = ['viewer', 'editor', 'admin']

export async function GET() {
  const b = await signageBruger()
  if (!b) return afvis()
  if (!erSuperadmin(b)) return NextResponse.json({ error: 'Kun superadmin' }, { status: 403 })

  return NextResponse.json({
    brugere:     await listAdminUsers(),
    tildelinger: await listAccess(),
  })
}

export async function POST(req: NextRequest) {
  const b = await signageBruger()
  if (!b) return afvis()
  if (!erSuperadmin(b)) return NextResponse.json({ error: 'Kun superadmin' }, { status: 403 })

  const body   = await req.json().catch(() => ({}))
  const userId = String(body.userId ?? '')
  const role   = ROLLER.includes(body.role) ? (body.role as SignageRole) : 'editor'
  const screenId = body.screenId ? String(body.screenId) : null
  const groupId  = body.groupId  ? String(body.groupId)  : null

  if (!userId) return NextResponse.json({ error: 'Bruger mangler' }, { status: 400 })
  // Præcis ét mål — ellers ved vi ikke hvad tildelingen gælder.
  if (Boolean(screenId) === Boolean(groupId))
    return NextResponse.json({ error: 'Vælg enten en skærm eller en gruppe' }, { status: 400 })

  await grantAccess(userId, { screenId, groupId }, role)
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const b = await signageBruger()
  if (!b) return afvis()
  if (!erSuperadmin(b)) return NextResponse.json({ error: 'Kun superadmin' }, { status: 403 })

  const body   = await req.json().catch(() => ({}))
  const userId = String(body.userId ?? '')
  if (!userId || typeof body.limited !== 'boolean')
    return NextResponse.json({ error: 'Mangler bruger eller flag' }, { status: 400 })

  // Man må ikke begrænse sig selv — så ville man kunne låse sig ude af sin egen
  // portal-admin på et enkelt klik.
  if (userId === b.userId && body.limited === true)
    return NextResponse.json({ error: 'Du kan ikke begrænse din egen adgang' }, { status: 400 })

  await setSignageLimited(userId, body.limited)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const b = await signageBruger()
  if (!b) return afvis()
  if (!erSuperadmin(b)) return NextResponse.json({ error: 'Kun superadmin' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })
  await revokeAccess(id)
  return NextResponse.json({ ok: true })
}
