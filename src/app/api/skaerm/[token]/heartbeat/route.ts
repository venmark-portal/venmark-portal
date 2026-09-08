// Playeren melder sig i live ~hvert 30. sek. Admin-listen viser grøn/rød ud fra
// lastHeartbeat, så man kan se hvilke skærme der reelt kører — i stedet for at
// gå en runde i huset.

import { NextResponse } from 'next/server'
import { getScreenByToken, touchHeartbeat } from '@/lib/signage/screens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(_req: Request, { params }: { params: { token: string } }) {
  const screen = await getScreenByToken(params.token)
  if (!screen) return new NextResponse('Not found', { status: 404 })

  await touchHeartbeat(params.token)
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
