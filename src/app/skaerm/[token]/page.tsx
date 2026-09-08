// Info-skærm. Åbnes af TV'et 24/7 på /skaerm/<deviceToken>.
//
// Token er skærmens eneste "login" — der er ingen bruger-session, så en skærm
// kan hverken se en anden skærms indhold eller kundedata. Ugyldigt eller
// deaktiveret token: 404.

import { notFound } from 'next/navigation'
import { getWidgetData } from '@/lib/signage/cache'
import { activeSlides, contentVersion, copenhagenNow, getScreenByToken } from '@/lib/signage/screens'
import Player from './Player'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SkaermPage({ params }: { params: { token: string } }) {
  const screen = await getScreenByToken(params.token)
  if (!screen || !screen.active) notFound()

  // Første billede server-rendres, så skærmen viser rigtige tal allerede ved
  // opstart — også hvis den tænder før nogen kigger på den. Samme tidsstempel
  // til både tidsplan og hash, så de ikke kan komme ud af trit.
  const nu      = copenhagenNow()
  const slides  = activeSlides(screen, nu)
  const widgets = await Promise.all(slides.map(s => getWidgetData(s.widgetId, s.params)))

  return (
    <Player
      token={screen.token}
      initial={{
        version:     contentVersion(screen, nu),
        name:        screen.name,
        orientation: screen.orientation,
        layout:      screen.layout,
        slides,
        widgets,
      }}
    />
  )
}
