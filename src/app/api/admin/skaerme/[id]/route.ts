import { NextRequest, NextResponse } from 'next/server'
import { afvis, erSuperadmin, maa, signageBruger } from '@/lib/signage/guard'
import { deleteScreen, getScreen, rotateToken, updateScreen } from '@/lib/signage/screens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await signageBruger()
  if (!b) return afvis()

  const screen = await getScreen(params.id)
  if (!screen) return new NextResponse('Not found', { status: 404 })

  const body = await req.json().catch(() => ({}))

  // Nyt token, omdøbning, layout og gruppe er skærm-admin. Indhold og
  // tænd/sluk er nok med editor.
  const kraeverAdmin =
    body.rotateToken === true || body.name !== undefined ||
    body.layout !== undefined || body.groupId !== undefined
  const kraevet = kraeverAdmin ? 'admin' : 'editor'
  if (!maa(b, screen, kraevet))
    return NextResponse.json({ error: 'Du har ikke rettigheder til den skærm' }, { status: 403 })

  if (body.rotateToken === true) {
    return NextResponse.json({ ok: true, token: await rotateToken(params.id) })
  }

  await updateScreen(params.id, {
    name:        typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
    orientation: body.orientation === 'portrait' || body.orientation === 'landscape' ? body.orientation : undefined,
    layout:      body.layout === 'split' || body.layout === 'single' ? body.layout : undefined,
    groupId:     body.groupId === undefined ? undefined : (body.groupId ? String(body.groupId) : null),
    active:      typeof body.active === 'boolean' ? body.active : undefined,
    slides:      Array.isArray(body.slides) ? body.slides : undefined,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const b = await signageBruger()
  if (!b) return afvis()
  if (!erSuperadmin(b))
    return NextResponse.json({ error: 'Kun superadmin kan slette skærme' }, { status: 403 })

  await deleteScreen(params.id)
  return NextResponse.json({ ok: true })
}
