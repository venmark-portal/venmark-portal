import { NextRequest, NextResponse } from 'next/server'
import { getItems, getItemsByNumbers, getWebshopVisibleItemNos } from '@/lib/businesscentral'
import { getPortalLang } from '@/lib/i18n/portal/server'
import { getVarenavne, oversaetVarenavne } from '@/lib/i18n/portal/varenavne'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const search   = searchParams.get('search')   ?? undefined
  const category = searchParams.get('category') ?? undefined
  const top      = Number(searchParams.get('top')  ?? 50)
  const skip     = Number(searchParams.get('skip') ?? 0)
  // Kun kundeportalens søgning sender portal=1 — admin og katalog beholder danske navne.
  const lang     = searchParams.get('portal') === '1' ? await getPortalLang() : 'da'

  try {
    // Søgning skal også respektere portal-synligheden (RangeringPrisliste = 99 = skjult).
    const [data, visible] = await Promise.all([
      getItems({ search, category, top, skip }),
      getWebshopVisibleItemNos().catch(() => null),
    ])
    const d = data as any
    if (lang !== 'da' && d && Array.isArray(d.value)) {
      // BC søger kun i det danske navn — "plaice" skal også finde rødspætte. Træf i de
      // oversatte navne hentes ekstra (kun første side, uden kategori-filter-tab).
      if (search?.trim() && !skip) {
        const q = search.trim().toLowerCase()
        const navne = await getVarenavne(lang)
        const har = new Set<string>(d.value.map((i: any) => i.number))
        const ekstraNr = Array.from(navne.entries())
          .filter(([nr, navn]) => !har.has(nr) && navn.toLowerCase().includes(q))
          .map(([nr]) => nr)
          .slice(0, top)
        if (ekstraNr.length) {
          const ekstra = await getItemsByNumbers(ekstraNr).catch(() => [])
          d.value.push(...ekstra.filter(i => !category || i.itemCategoryCode === category))
        }
      }
      // navnDa: det danske navn følger med, så favoritter/linjer gemmes på dansk i BC.
      d.value = await oversaetVarenavne(d.value.map((i: any) => ({ ...i, navnDa: i.displayName })), lang)
    }
    if (visible && d && Array.isArray(d.value))
      d.value = d.value.filter((i: any) => visible.has(i.number))
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ukendt fejl'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
