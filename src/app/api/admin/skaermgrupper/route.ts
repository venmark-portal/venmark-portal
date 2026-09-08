import { NextRequest, NextResponse } from 'next/server'
import { afvis, erSuperadmin, signageBruger } from '@/lib/signage/guard'
import { createGroup, listGroups } from '@/lib/signage/screens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const b = await signageBruger()
  if (!b) return afvis()
  return NextResponse.json(await listGroups())
}

export async function POST(req: NextRequest) {
  const b = await signageBruger()
  if (!b) return afvis()
  if (!erSuperadmin(b))
    return NextResponse.json({ error: 'Kun superadmin kan oprette grupper' }, { status: 403 })

  const name = String((await req.json().catch(() => ({}))).name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Navn mangler' }, { status: 400 })
  return NextResponse.json(await createGroup(name))
}
