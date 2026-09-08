import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { deleteScreen, rotateToken, updateScreen } from '@/lib/signage/screens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function guard() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  return null
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await guard()
  if (denied) return denied

  const body = await req.json().catch(() => ({}))

  if (body.rotateToken === true) {
    const token = await rotateToken(params.id)
    return NextResponse.json({ ok: true, token })
  }

  await updateScreen(params.id, {
    name:        typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
    orientation: body.orientation === 'portrait' || body.orientation === 'landscape' ? body.orientation : undefined,
    active:      typeof body.active === 'boolean' ? body.active : undefined,
    slides:      Array.isArray(body.slides) ? body.slides : undefined,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await guard()
  if (denied) return denied

  await deleteScreen(params.id)
  return NextResponse.json({ ok: true })
}
