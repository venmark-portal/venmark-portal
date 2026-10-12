// Slår et telefonnummer op på en debitor, så opkaldsstatistikken kan sige
// "Fisk er godt" frem for "+4530380811".
//
// Numrene står i BC i alle mulige former — "98 12 34 56", "+45 98123456",
// "004598123456", "98123456" — og Teams leverer dem altid som "+4598123456".
// Derfor normaliseres begge sider til rene cifre med landekode, før de sammenlignes.

import { getAccessToken, bcBaseUrl } from '@/lib/businesscentral'

export interface KundeOpslag {
  kundeNr: string
  navn:    string
}

/**
 * Rene cifre med landekode. Et dansk nummer uden landekode er otte cifre — dem
 * sætter vi 45 foran, så "98123456" og "+4598123456" bliver det samme.
 * Tom streng = kan ikke bruges til opslag.
 */
export function normaliserNummer(raa: string | null | undefined): string {
  let n = String(raa ?? '').replace(/\D+/g, '')
  if (!n) return ''
  if (n.startsWith('00')) n = n.slice(2)
  if (n.length === 8) n = '45' + n
  // Under 8 cifre er et lokalnummer eller en stump — ikke noget at slå op på.
  return n.length >= 10 ? n : ''
}

let cache: { kort: Map<string, KundeOpslag>; hentet: number } | null = null
const LEVETID_MS = 60 * 60 * 1000   // debitorers numre ændrer sig sjældent

/**
 * Nummer → debitor. Hentes én gang i timen; 1800 debitorer er ét kald, og
 * opslaget bruges på hver eneste række i telefonstatistikken.
 */
export async function hentKundeNumre(): Promise<Map<string, KundeOpslag>> {
  if (cache && Date.now() - cache.hentet < LEVETID_MS) return cache.kort

  const kort = new Map<string, KundeOpslag>()
  try {
    const token   = await getAccessToken()
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    // Intet $top: BC svarer med præcis det antal man beder om og UDEN nextLink, så
    // et loft ville afkorte tavst. Vi følger nextLink i stedet.
    let url: string | null = `${bcBaseUrl()}/customers?$select=number,displayName,phoneNumber`

    let sider = 0
    while (url && sider++ < 40) {
      const res: Response = await fetch(url, { headers, cache: 'no-store' } as any)
      if (!res.ok) break
      const data = await res.json()
      for (const c of (data.value ?? [])) {
        const n = normaliserNummer(c.phoneNumber)
        if (!n) continue
        // Første debitor på nummeret vinder. Deler to debitorer nummer (fx en kæde
        // med fælles omstilling), er der ikke noget rigtigt svar, og et gæt der
        // skifter fra dag til dag ville være værre end det første.
        if (!kort.has(n)) kort.set(n, { kundeNr: String(c.number ?? ''), navn: String(c.displayName ?? '').trim() })
      }
      url = data['@odata.nextLink'] ?? null
    }
    cache = { kort, hentet: Date.now() }
  } catch {
    // Uden opslaget vises numrene bare som numre — statistikken skal ikke falde
    // fra hinanden fordi debitorlisten ikke kunne hentes.
    if (cache) return cache.kort
  }
  return kort
}
