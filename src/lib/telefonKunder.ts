// Slår et telefonnummer op på en debitor (eller leverandør), så opkaldsstatistikken
// kan sige "Fisk er godt" frem for "+4530380811".
//
// Numrene står i BC i alle mulige former — "98 12 34 56", "+45 98123456",
// "004598123456", "98123456" — og Teams leverer dem altid som "+4598123456".
// Derfor normaliseres begge sider til rene cifre med landekode, før de sammenlignes.
//
// KILDER: før blev kun debitorens hovednummer slået op, og de fleste kunder ringer
// fra en mobil — så halvdelen af top-listen stod som ukendte numre (11-11-2026).
// BC-side 50480 "telefonNumre" samler nu debitorens telefon + mobil, Kontakt 1-3,
// kontaktpersoner, leveringsadresser og leverandører. Findes siden ikke (før Force
// Sync), falder vi tilbage på debitorer + leverandører fra standard-API'et.

import { getAccessToken, bcBaseUrl, bcPortalBaseUrl } from '@/lib/businesscentral'

export interface KundeOpslag {
  kundeNr: string
  navn:    string
  /** Personen bag nummeret (kontaktperson, Kontakt 1-3, leveringsadresse). */
  kontakt?: string
  slags:   'Debitor' | 'Leverandør'
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
const LEVETID_MS = 60 * 60 * 1000   // numrene ændrer sig sjældent

/**
 * Hvilken kilde der vinder, når samme nummer står flere steder. Debitorens eget
 * nummer slår en kontaktperson, og en kunde slår altid en leverandør — vi vil
 * hellere kalde et nummer en kunde vi kender end en leverandør der deler omstilling.
 */
const PRIORITET: Record<string, number> = {
  debitor: 1, debitorMobil: 2, debitorKontakt: 3, kontakt: 4, leveringsadresse: 5,
  leverandoer: 6, leverandoerKontakt: 7,
}

async function hentSider(url0: string, headers: Record<string, string>): Promise<any[] | null> {
  const ud: any[] = []
  let url: string | null = url0
  let sider = 0
  // Intet $top: BC svarer med præcis det antal man beder om og UDEN nextLink, så
  // et loft ville afkorte tavst. Vi følger nextLink i stedet.
  while (url && sider++ < 60) {
    const res: Response = await fetch(url, { headers, cache: 'no-store' } as any)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`BC ${res.status}`)
    const data = await res.json()
    ud.push(...(data.value ?? []))
    url = data['@odata.nextLink'] ?? null
  }
  return ud
}

/** Nummer → debitor/leverandør. Hentes én gang i timen. */
export async function hentKundeNumre(): Promise<Map<string, KundeOpslag>> {
  if (cache && Date.now() - cache.hentet < LEVETID_MS) return cache.kort

  const kort = new Map<string, KundeOpslag>()
  const rang = new Map<string, number>()
  const saet = (raa: unknown, prio: number, v: KundeOpslag) => {
    const n = normaliserNummer(String(raa ?? ''))
    if (!n) return
    // Ved samme prioritet vinder den første. Deler to debitorer nummer (fx en kæde
    // med fælles omstilling), er der ikke noget rigtigt svar, og et gæt der
    // skifter fra dag til dag ville være værre end det første.
    if ((rang.get(n) ?? 99) <= prio) return
    rang.set(n, prio)
    kort.set(n, v)
  }

  try {
    const token   = await getAccessToken()
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

    const alle = await hentSider(`${bcPortalBaseUrl()}/telefonNumre`, headers)
    if (alle) {
      for (const r of alle) {
        saet(r.number, PRIORITET[r.source] ?? 50, {
          kundeNr: String(r.accountNo ?? ''),
          navn:    String(r.accountName ?? '').trim(),
          kontakt: String(r.contactName ?? '').trim() || undefined,
          slags:   r.kind === 'Leverandør' ? 'Leverandør' : 'Debitor',
        })
      }
    } else {
      // Før BC-side 50480 er synkroniseret: kun hovednumrene fra standard-API'et.
      const [kunder, kreditorer] = await Promise.all([
        hentSider(`${bcBaseUrl()}/customers?$select=number,displayName,phoneNumber`, headers),
        hentSider(`${bcBaseUrl()}/vendors?$select=number,displayName,phoneNumber`, headers).catch(() => null),
      ])
      for (const c of kunder ?? []) {
        saet(c.phoneNumber, 1, { kundeNr: String(c.number ?? ''), navn: String(c.displayName ?? '').trim(), slags: 'Debitor' })
      }
      for (const v of kreditorer ?? []) {
        saet(v.phoneNumber, 6, { kundeNr: String(v.number ?? ''), navn: String(v.displayName ?? '').trim(), slags: 'Leverandør' })
      }
    }
    cache = { kort, hentet: Date.now() }
  } catch {
    // Uden opslaget vises numrene bare som numre — statistikken skal ikke falde
    // fra hinanden fordi listen ikke kunne hentes.
    if (cache) return cache.kort
  }
  return kort
}
