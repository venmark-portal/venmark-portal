// Hele skærmens tilstand: ramme, de slides der er aktive lige nu, og deres
// BC-data. Slides og data hentes i SAMME kald og ud fra det samme tidsstempel —
// ellers kunne et tidsplanlagt slide skifte mellem to kald, og playeren ville
// parre en widget med det forkerte slide.
//
// Alle skærme deler cachen bag getWidgetData, så endpointet koster typisk nul
// BC-kald. Ved BC-nedbrud kommer sidste gode data retur med stale=true, så
// playeren kan skrive "opdateret kl. HH:MM" i stedet for at gå sort.

import { NextResponse } from 'next/server'
import { getWidgetData } from '@/lib/signage/cache'
import { activeSlides, contentVersion, copenhagenNow, getScreenByToken } from '@/lib/signage/screens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const screen = await getScreenByToken(params.token)
  if (!screen || !screen.active) {
    return new NextResponse('Not found', { status: 404 })
  }

  const nu     = copenhagenNow()
  const slides = activeSlides(screen, nu)
  const widgets = await Promise.all(slides.map(s => getWidgetData(s.widgetId, s.params)))

  return NextResponse.json(
    {
      version:     contentVersion(screen, nu),
      name:        screen.name,
      orientation: screen.orientation,
      layout:      screen.layout,
      slides,
      widgets,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
