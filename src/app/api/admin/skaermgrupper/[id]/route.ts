import { NextRequest, NextResponse } from 'next/server'
import { afvis, erSuperadmin, signageBruger } from '@/lib/signage/guard'
import { deleteGroup, renameGroup } from '@/lib/signage/screens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await signageBruger()
  if (!b) return afvis()
  if (!erSuperadmin(b)) return NextResponse.json({ error: 'Kun superadmin' }, { status: 403 })

  const name = String((await req.json().catch(() => ({}))).name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Navn mangler' }, { status: 400 })
  await renameGroup(params.id, name)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const b = await signageBruger()
  if (!b) return afvis()
  if (!erSuperadmin(b)) return NextResponse.json({ error: 'Kun superadmin' }, { status: 403 })

  // Skærmene overlever — de mister bare deres gruppe.
  await deleteGroup(params.id)
  return NextResponse.json({ ok: true })
}
