// Let manifest som playeren poller hvert 10-30 sek.
// Indeholder KUN opsætningen + en versions-hash — ingen BC-data (det ligger i
// /data). Ændrer redaktøren noget, skifter hashen og playeren henter forfra.
// Det er "push" nok til et TV, uden at holde en socket åben i døgndrift.

import { NextResponse } from 'next/server'
import { contentVersion, getScreenByToken } from '@/lib/signage/screens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const screen = await getScreenByToken(params.token)
  if (!screen || !screen.active) {
    return new NextResponse('Not found', { status: 404 })
  }

  return NextResponse.json(
    {
      version:     contentVersion(screen),
      name:        screen.name,
      orientation: screen.orientation,
      slides:      screen.slides,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
