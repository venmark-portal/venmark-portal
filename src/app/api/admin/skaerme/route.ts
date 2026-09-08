import { NextRequest, NextResponse } from 'next/server'
import { afvis, erSuperadmin, rolle, signageBruger, synligeSkaerme } from '@/lib/signage/guard'
import { createScreen, listGroups, listScreens } from '@/lib/signage/screens'
import { widgetCatalog } from '@/lib/signage/widgets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const b = await signageBruger()
  if (!b) return afvis()

  const mine = synligeSkaerme(b, await listScreens())

  return NextResponse.json({
    // Rollen følger med pr. skærm, så UI'et kan skjule det man ikke må røre.
    screens:    mine.map(s => ({ ...s, minRolle: rolle(b, s) })),
    grupper:    await listGroups(),
    katalog:    widgetCatalog(),
    superadmin: erSuperadmin(b),
  })
}

export async function POST(req: NextRequest) {
  const b = await signageBruger()
  if (!b) return afvis()
  if (!erSuperadmin(b))
    return NextResponse.json({ error: 'Kun superadmin kan oprette skærme' }, { status: 403 })

  const body        = await req.json().catch(() => ({}))
  const name        = String(body.name ?? '').trim()
  const orientation = body.orientation === 'portrait' ? 'portrait' : 'landscape'
  const layout      = body.layout === 'split' ? 'split' : 'single'
  const groupId     = body.groupId ? String(body.groupId) : null
  if (!name) return NextResponse.json({ error: 'Navn mangler' }, { status: 400 })

  return NextResponse.json(await createScreen(name, orientation, groupId, layout))
}
