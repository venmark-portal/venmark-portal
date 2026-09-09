// Let manifest som playeren poller hvert 10-30 sek.
// Indeholder KUN en versions-hash + skærmens ramme — ingen BC-data og ingen
// slides (dem henter playeren sammen med data, så de to altid passer sammen).
//
// Hashen beregnes ud fra de slides der er AKTIVE lige nu, så den skifter også af
// sig selv når et tidsplanlagt slide går ind eller ud. Intet baggrundsjob.

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { contentVersion, getScreenByToken } from '@/lib/signage/screens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Sættes én gang når serveren starter, altså ved hvert deploy. En skærm der har
// kørt siden før et deploy, kører videre på den GAMLE JavaScript-kode — den
// navigerer jo aldrig, så den henter aldrig ny. Playeren genindlæser sig selv
// når dette id skifter; ellers skulle nogen gå rundt og trykke F5 på hvert TV.
const SERVER_ID = randomUUID().slice(0, 8)

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const screen = await getScreenByToken(params.token)
  if (!screen || !screen.active) {
    return new NextResponse('Not found', { status: 404 })
  }

  return NextResponse.json(
    {
      version:     contentVersion(screen),
      serverId:    SERVER_ID,
      name:        screen.name,
      orientation: screen.orientation,
      layout:      screen.layout,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
