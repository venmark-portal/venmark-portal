// Varenavne på kundens sprog fra BC's Portal Vareoversættelser (tabel 50106 — samme som
// prislisterne; API-side 50473). Godkendt tekst, ellers forslaget. Status Rød (må ikke
// publiceres) og "Kilde ændret" (dansk navn rettet siden) giver det danske navn — en gammel
// oversættelse kan have forkert størrelse/sortering. Kun kundeportalen kalder dette —
// admin og pakkeri skal altid se de danske navne.

import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'
import { BC_LANG_CODES, type Lang } from './lang'

const TTL_MS = 30 * 60 * 1000
const cache = new Map<Lang, { navne: Map<string, string>; t: number }>()
const igang = new Map<Lang, Promise<Map<string, string>>>()

async function hentFraBC(lang: Lang): Promise<Map<string, string>> {
  const koder = BC_LANG_CODES[lang]
  const navne = new Map<string, string>()
  const prioritet = new Map<string, number>()   // laveste indeks i koder vinder (ENU før ENG)
  const token = await getAccessToken()
  const filter = encodeURIComponent(koder.map(k => `languageCode eq '${k}'`).join(' or '))
  // Ingen $top — den dræber nextLink (BC afkorter tavst). Følg nextLink i stedet.
  let url: string | undefined =
    `${bcPortalBaseUrl()}/itemTranslations?$filter=${filter}&$select=itemNo,languageCode,approvedDescription,suggestedDescription,status,sourceIsStale`
  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) {
      // 404 = API-siden findes ikke endnu (BC før v29.0.147.454) — danske navne indtil Force Sync.
      console.warn(`[varenavne] itemTranslations ${res.status}: ${(await res.text()).slice(0, 160)}`)
      break
    }
    const data: any = await res.json()
    for (const r of data.value ?? []) {
      const tekst = String(r.approvedDescription || r.suggestedDescription || '').trim()
      if (!r.itemNo || !tekst || r.status === 'Red' || r.sourceIsStale) continue
      const p = koder.indexOf(String(r.languageCode).toUpperCase())
      const før = prioritet.get(r.itemNo)
      if (før !== undefined && før <= p) continue
      prioritet.set(r.itemNo, p)
      navne.set(r.itemNo, tekst)
    }
    url = data['@odata.nextLink']
  }
  return navne
}

/** varenr → oversat navn for sproget (tom for dansk). Fejl = tom map (danske navne). */
export async function getVarenavne(lang: Lang): Promise<Map<string, string>> {
  if (lang === 'da') return new Map()
  const hit = cache.get(lang)
  if (hit && Date.now() - hit.t < TTL_MS) return hit.navne
  let p = igang.get(lang)
  if (!p) {
    p = hentFraBC(lang)
      .catch(e => {
        console.warn('[varenavne] fejl:', e instanceof Error ? e.message : e)
        return hit?.navne ?? new Map<string, string>()
      })
      .then(navne => { cache.set(lang, { navne, t: Date.now() }); return navne })
      .finally(() => igang.delete(lang))
    igang.set(lang, p)
  }
  return p
}

/**
 * Erstatter navnefeltet på hver vare med oversættelsen. Feltnavn og varenr-felt kan angives,
 * så den virker på både BCItem (`number`/`displayName`) og ordrelinjer (`itemNo`/`description`).
 */
export async function oversaetVarenavne<T extends Record<string, any>>(
  items: T[],
  lang: Lang,
  felter: { nr?: keyof T; navn?: keyof T } = {},
): Promise<T[]> {
  if (lang === 'da' || !items.length) return items
  const navne = await getVarenavne(lang)
  if (!navne.size) return items
  const nrFelt = (felter.nr ?? 'number') as string
  const navnFelt = (felter.navn ?? 'displayName') as string
  return items.map(it => {
    const ny = navne.get(String(it[nrFelt] ?? ''))
    return ny ? { ...it, [navnFelt]: ny } : it
  })
}
