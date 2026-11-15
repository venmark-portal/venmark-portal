// Varesøgning i HELE kataloget — bruges af portalens søgefelt (api/products) og svar-robotten.
//
// BC's OData-søgning (contains) skelner mellem store og små bogstaver og søger på hele
// sætningen. "bakka" fandt derfor ikke "Færøsk laksefilet 1700-2100 BAKKA", og "laks bakka"
// fandt ingenting (Claus' test 15-11-2026). Her hentes alle varenavne én gang (huskes 15
// min), og der søges lokalt: uden hensyn til store/små bogstaver, ord for ord, i vilkårlig
// rækkefølge.

import { getAccessToken, bcBaseUrl } from '@/lib/businesscentral'
import { getVarenavne } from '@/lib/i18n/portal/varenavne'
import type { Lang } from '@/lib/i18n/portal/lang'

interface KatalogVare { nr: string; navn: string }

let cache: { varer: KatalogVare[]; t: number } | null = null
let igang: Promise<KatalogVare[]> | null = null
const TTL = 15 * 60_000

async function hent(): Promise<KatalogVare[]> {
  const token = await getAccessToken()
  const varer: KatalogVare[] = []
  // Ingen $top — så udelader BC nextLink og kataloget bliver tavst afkortet.
  let url: string | null = `${bcBaseUrl()}/items?$select=number,displayName`
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) throw new Error(`BC items ${res.status}`)
    const data: any = await res.json()
    for (const i of data.value ?? []) {
      const nr = String(i.number ?? '')
      if (nr && !nr.toUpperCase().startsWith('X')) varer.push({ nr, navn: String(i.displayName ?? '') })
    }
    url = data['@odata.nextLink'] ?? null
  }
  return varer
}

async function katalog(): Promise<KatalogVare[]> {
  if (cache && Date.now() - cache.t < TTL) return cache.varer
  if (!igang) {
    igang = hent()
      .then(v => { cache = { varer: v, t: Date.now() }; return v })
      .finally(() => { igang = null })
  }
  // Udløbet: søg i det kendte katalog nu og lad det nye hente i baggrunden — ellers venter
  // én kunde hvert kvarter på hele kataloget. Kun allerførste søgning efter genstart venter.
  if (cache) { igang.catch(err => console.error('[katalog] genindlæsning fejlede', err)); return cache.varer }
  return igang
}

const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/[^0-9a-zæøåäöüéèáàíóúß]+/g, ' ').trim()

/** Matcher søgeordet navnet? Ordet står i navnet — eller et navneord på ≥4 tegn er starten
 *  af søgeordet ("bakkafrost" → "BAKKA", "laksefileter" → "laksefilet"). */
function ordMatcher(ord: string, navn: string, navneOrd: string[]): boolean {
  if (navn.includes(ord)) return true
  return navneOrd.some(t => t.length >= 4 && ord.startsWith(t))
}

/**
 * Varenumre der matcher, bedste først. Alle ord skal matche; giver det intet, tages de
 * varer der matcher flest ord. Varenummer matcher direkte.
 */
export async function soegKatalog(q: string, sprog: Lang, max = 60): Promise<string[]> {
  const ord = norm(q).split(' ').filter(o => o.length >= 2)
  if (!ord.length) return []
  const [varer, oversat] = await Promise.all([
    katalog(),
    sprog === 'da' ? Promise.resolve(new Map<string, string>()) : getVarenavne(sprog).catch(() => new Map<string, string>()),
  ])

  const scoret: { nr: string; n: number; laengde: number; nrTraef: boolean }[] = []
  for (const v of varer) {
    const navn = norm(`${v.navn} ${oversat.get(v.nr) ?? ''} ${v.nr}`)
    const navneOrd = navn.split(' ')
    let n = 0
    for (const o of ord) if (v.nr.toLowerCase().startsWith(o) || ordMatcher(o, navn, navneOrd)) n++
    if (n > 0) scoret.push({ nr: v.nr, n, laengde: v.navn.length, nrTraef: ord.some(o => v.nr.toLowerCase().startsWith(o)) })
  }
  const bedst = Math.max(0, ...scoret.map(s => s.n))
  // Kræv alle ord; kun hvis ingen vare har dem alle, nøjes vi med det bedste.
  const krav = scoret.some(s => s.n === ord.length) ? ord.length : bedst
  return scoret
    .filter(s => s.n >= krav)
    // Varenummer-træf først (som den gamle søgning), så flest ord, så korteste navn.
    .sort((a, b) => Number(b.nrTraef) - Number(a.nrTraef) || b.n - a.n || a.laengde - b.laengde)
    .slice(0, max)
    .map(s => s.nr)
}
