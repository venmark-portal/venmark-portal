// BC-data til én skærm. Alle skærme deler cachen bag getWidgetData, så det her
// endpoint koster typisk nul BC-kald — og ved BC-nedbrud kommer sidste gode
// data retur med stale=true, så playeren kan skrive "opdateret kl. HH:MM".

import { NextResponse } from 'next/server'
import { getWidgetData } from '@/lib/signage/cache'
import { contentVersion, getScreenByToken } from '@/lib/signage/screens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const screen = await getScreenByToken(params.token)
  if (!screen || !screen.active) {
    return new NextResponse('Not found', { status: 404 })
  }

  const widgets = await Promise.all(
    screen.slides.map(s => getWidgetData(s.widgetId, s.params)),
  )

  return NextResponse.json(
    { version: contentVersion(screen), widgets },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
