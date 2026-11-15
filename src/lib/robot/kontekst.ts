// Alt det robotten skal vide om den indloggede kunde for at kunne svare: leveringsform,
// de næste leveringsdage med frist, priser og hvilke varer kunden må se. Spejler
// bestillingssiden (bestil/page.tsx), så robotten aldrig siger noget andet end skærmen.
//
// Hentes dovent og huskes for ét spørgsmål — robotten kalder typisk flere værktøjer i
// træk, og de skal ikke hente prislisten forfra hver gang.

import { prisma } from '@/lib/prisma'
import {
  getPortalPrices, getWebshopVisibleItemNos, getPortalShipmentMethods, getPortalCalendarDays,
  getCustomerShipmentMethodCode, getCustomerPortalShipmentMethods, getCustomerLocationCode, getCustomerFavorites,
  type BCPortalPrice, type BCShipmentMethod, type BCCalendarDay,
} from '@/lib/businesscentral'
import { getDeliveryDatesForMethod, getDeadlineForMethodDelivery, nextBusinessDays } from '@/lib/dateUtils'
import { ymdLokal } from '@/lib/aabenOrdre'

export interface RobotKunde {
  customerId:  string   // portal-id (Customer.id) — nøgle for kurv, favoritter i portal-DB, log
  customerNo:  string   // AKTIV BC-kunde (valgt butik ved "bestil på vegne af")
  navn:        string
  priceGrp:    string
  chainGrp:    string
  sprog:       'da' | 'en' | 'de'
  somAdmin:    string | null   // admin der kigger med som kunden
}

export interface Leveringsdag { dato: string; frist: Date }

export class RobotKontekst {
  constructor(public kunde: RobotKunde) {}

  /** Sat når robotten har ændret kurven — chatten genindlæser så bestillingssiden. */
  kurvAendret = false
  /** Leveringsdagen robotten lagde i kurven til — bestillingssiden åbner på den. */
  kurvDato: string | null = null
  /** Sat når robotten har flyttet en ordre — chatten genindlæser ordresiden. */
  ordreAendret = false

  private memo = new Map<string, Promise<any>>()
  private husk<T>(k: string, f: () => Promise<T>): Promise<T> {
    if (!this.memo.has(k)) this.memo.set(k, f())
    return this.memo.get(k)!
  }

  lokation(): Promise<string> {
    return this.husk('lok', () => getCustomerLocationCode(this.kunde.customerNo).catch(() => ''))
  }

  priser(): Promise<BCPortalPrice[]> {
    return this.husk('priser', () =>
      getPortalPrices(this.kunde.customerNo, this.kunde.priceGrp, this.kunde.chainGrp).catch(() => []))
  }

  /** null = BC svarede ikke → alt er synligt (samme fallback som bestillingssiden). */
  synlige(): Promise<Set<string> | null> {
    return this.husk('synlige', () => getWebshopVisibleItemNos().catch(() => null))
  }

  blokerede(): Promise<Set<string>> {
    return this.husk('blok', async () => {
      const rows = await prisma.blockedItem.findMany({ where: { customerId: this.kunde.customerId } }).catch(() => [])
      return new Set(rows.map(r => r.bcItemNumber))
    })
  }

  /** Må kunden se varen? Samme regel som bestillingssiden: ikke blokeret, ikke X-vare, på ranglisten. */
  async maaSe(itemNo: string): Promise<boolean> {
    if (!itemNo || itemNo.toUpperCase().startsWith('X')) return false
    const [synlige, blok] = await Promise.all([this.synlige(), this.blokerede()])
    if (blok.has(itemNo)) return false
    return synlige === null || synlige.has(itemNo)
  }

  /** Kundens favoritter: STD (varer kunden altid skal have) og øvrige aktive favoritter. */
  favoritter(): Promise<{ std: Set<string>; fav: Set<string> }> {
    return this.husk('fav', async () => {
      const l = await getCustomerFavorites(this.kunde.customerNo).catch(() => [])
      const aktive = l.filter(f => f.active !== false)
      return {
        std: new Set(aktive.filter(f => f.standardFavorite).map(f => f.itemNo)),
        fav: new Set(aktive.filter(f => !f.standardFavorite).map(f => f.itemNo)),
      }
    })
  }

  metoder(): Promise<{ alle: BCShipmentMethod[]; kundens: BCShipmentMethod | undefined; tilladte: BCShipmentMethod[] }> {
    return this.husk('metoder', async () => {
      const [alle, kode, tilladteKoder] = await Promise.all([
        getPortalShipmentMethods().catch(() => [] as BCShipmentMethod[]),
        getCustomerShipmentMethodCode(this.kunde.customerNo).catch(() => ''),
        getCustomerPortalShipmentMethods(this.kunde.customerNo).catch(() => [] as string[]),
      ])
      const tilladte = tilladteKoder.length > 0
        ? alle.filter(m => tilladteKoder.includes(m.code))
        : alle.filter(m => m.code === kode)
      const kundens = tilladte[0] ?? alle.find(m => m.code === kode)
      return { alle, kundens, tilladte: tilladte.length ? tilladte : (kundens ? [kundens] : []) }
    })
  }

  kalender(): Promise<BCCalendarDay[]> {
    return this.husk('kal', () => {
      const fra = new Date(); const til = new Date(); til.setDate(til.getDate() + 60)
      return getPortalCalendarDays(ymdLokal(fra), ymdLokal(til)).catch(() => [])
    })
  }

  /** De næste leveringsdage for kundens leveringsform, med bestillingsfristen for hver. */
  leveringsdage(antal = 10): Promise<Leveringsdag[]> {
    return this.husk(`lev${antal}`, async () => {
      const [{ kundens }, kal] = await Promise.all([this.metoder(), this.kalender()])
      const nu = new Date()
      const dage = kundens ? getDeliveryDatesForMethod(kundens, kal, nu, antal) : []
      const brug = dage.length ? dage : nextBusinessDays(nu, antal)
      return brug.map(d => ({
        dato:  ymdLokal(d),
        frist: kundens ? getDeadlineForMethodDelivery(d, kundens, kal) : d,
      }))
    })
  }
}

/** Visningspris for 1 stk./kg i dag — kunde > kæde > gruppe/alle, som bestillingssiden. */
export function prisFor(itemNo: string, priser: BCPortalPrice[], idag: string): { pris: number; enhed: string } | null {
  const gyldige = priser.filter(p =>
    p.itemNo === itemNo && p.minimumQuantity <= 1 &&
    (!p.startingDate || p.startingDate <= idag) &&
    (!p.endingDate || p.endingDate.startsWith('0001') || p.endingDate >= idag))
  if (!gyldige.length) return null
  const minPrio = Math.min(...gyldige.map(p => p.sourcePriority ?? 2))
  const top = gyldige.filter(p => (p.sourcePriority ?? 2) === minPrio)
  const bedst = top.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a))
  return { pris: bedst.unitPrice, enhed: bedst.unitOfMeasure }
}

/** Trappepriser (antal ≥ X) for en vare i dag, når der er flere end én. */
export function trappeFor(itemNo: string, priser: BCPortalPrice[], idag: string): { fraAntal: number; pris: number; enhed: string }[] {
  const gyldige = priser.filter(p =>
    p.itemNo === itemNo && p.minimumQuantity > 1 &&
    (!p.startingDate || p.startingDate <= idag) &&
    (!p.endingDate || p.endingDate.startsWith('0001') || p.endingDate >= idag))
  return gyldige
    .sort((a, b) => a.minimumQuantity - b.minimumQuantity)
    .map(p => ({ fraAntal: p.minimumQuantity, pris: p.unitPrice, enhed: p.unitOfMeasure }))
}
