import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createScreen, listScreens } from '@/lib/signage/screens'
import { widgetCatalog } from '@/lib/signage/widgets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function guard() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  return null
}

export async function GET() {
  const denied = await guard()
  if (denied) return denied

  const screens = await listScreens()
  return NextResponse.json({ screens, katalog: widgetCatalog() })
}

export async function POST(req: NextRequest) {
  const denied = await guard()
  if (denied) return denied

  const body        = await req.json().catch(() => ({}))
  const name        = String(body.name ?? '').trim()
  const orientation = body.orientation === 'portrait' ? 'portrait' : 'landscape'
  if (!name) return NextResponse.json({ error: 'Navn mangler' }, { status: 400 })

  const screen = await createScreen(name, orientation)
  return NextResponse.json(screen)
}
