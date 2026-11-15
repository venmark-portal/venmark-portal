// Varekataloget håndterminalen tager med sig offline.
//
// Kun det en scanner skal kunne vise og genkende: nummer, navn, enhed, kategori, GTIN.
// IKKE beholdning — optællingen er BLIND, og en terminal der kender BC's tal kan ikke
// tælle blindt. Sammenligningen sker på serveren når tællingen sendes ind.
//
// Hentes med nextLink hele vejen og ALDRIG med $top: $top slår nextLink fra, og så
// stopper kataloget tavst midt i — det gjorde 3.200 varer usynlige på portalen én gang.

import { bcBaseUrl, getAccessToken } from '@/lib/businesscentral'

export interface KatalogVare {
  nr: string
  navn: string
  enhed: string
  kategori: string
  gtin: string
  aendret: string
}

export interface Katalog {
  varer: KatalogVare[]
  /** Nyeste lastModifiedDateTime i svaret. Sendes med næste gang som ?since= */
  version: string
  komplet: boolean
}

export async function hentKatalog(since = ''): Promise<Katalog> {
  const token = await getAccessToken()
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

  const select = 'number,displayName,baseUnitOfMeasureCode,itemCategoryCode,gtin,blocked,type,lastModifiedDateTime'
  // Spærrede varer tages MED: en spærret vare kan udmærket stå på hylden og skal kunne
  // tælles. Appen viser den bare med et mærke. Kun tjenesteydelser er uden lager.
  const filterParts = [`type eq 'Inventory'`]
  if (since) filterParts.push(`lastModifiedDateTime gt ${since}`)

  let url =
    `${bcBaseUrl()}/items?$select=${select}` +
    `&$filter=${encodeURIComponent(filterParts.join(' and '))}` +
    `&$orderby=lastModifiedDateTime`

  const varer: KatalogVare[] = []
  let version = since
  let komplet = true
  let sider = 0

  while (url) {
    const res = await fetch(url, { headers, cache: 'no-store' } as any)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[lager katalog] GET fejlede ${res.status}: ${body}`)
      komplet = false
      break
    }
    const data = await res.json()
    for (const v of data.value ?? []) {
      varer.push({
        nr: v.number ?? '',
        navn: v.displayName ?? '',
        enhed: v.baseUnitOfMeasureCode ?? '',
        kategori: v.itemCategoryCode ?? '',
        gtin: (v.gtin ?? '').trim(),
        aendret: v.lastModifiedDateTime ?? '',
      })
      if (v.lastModifiedDateTime && v.lastModifiedDateTime > version) {
        version = v.lastModifiedDateTime
      }
    }
    url = data['@odata.nextLink'] ?? ''
    sider++
    // Nødbremse: et katalog på 4.000 varer er ~20 sider. Står vi ved 200, er noget
    // i stykker, og så skal vi ikke hænge i en løkke mod BC.
    if (sider > 200) {
      komplet = false
      console.error('[lager katalog] For mange sider — stoppede ved 200')
      break
    }
  }

  return { varer, version, komplet }
}
