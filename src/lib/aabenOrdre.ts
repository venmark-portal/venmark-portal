// Én ordre pr. leverance.
//
// Bestiller kunden to gange til samme dag på samme leveringsform, skal den anden
// bestilling LÆGGES PÅ den første frem for at blive en ordre mere. Ellers ender
// pakkeriet med to sedler til samme bil, og kunden med to fakturaer. Vi har set
// en kunde med elleve åbne ordrer til samme dag.
//
// Undtagelsen er en ordre der allerede er PAKKET (Packed By sat på salgshovedet) —
// den kan ikke nå at få mere med, og så er en ny ordre det rigtige.
//
// Forskellig leveringsform samme dag er IKKE en dublet: enkelte kunder får to
// leveringer om dagen, tidlig og sen, og de skal holdes adskilt.

import { getCustomerOrders, getPortalLineStatuses, type BCCustomerOrder } from '@/lib/businesscentral'

export interface AabenOrdre {
  bcOrderId:     string
  bcOrderNumber: string
  /** Leveringsdato som YYYY-MM-DD. */
  dato:          string
  antalLinjer:   number
  beloeb:        number
  /** Pakket = kan ikke udvides; kalderen skal oprette en ny ordre. */
  pakket:        boolean
  /** Falsk = tastet i BC (telefon/mail). Kunden skal stadig kunne lægge på den. */
  fraPortal:     boolean
}

/**
 * Leveringsdatoen på en ordre. BC-tastede ordrer udfylder IKKE "ønsket leveringsdato"
 * — 88 af 113 åbne ordrer stod uden — så dér er linjernes afsendelsesdato den eneste
 * kilde. Matcher vi kun på ønsket leveringsdato, opdager portalen ikke en ordre
 * kontoret har taget i telefonen samme formiddag, og så får kunden ordre nummer to
 * alligevel.
 */
function datoFor(o: BCCustomerOrder, linjeDatoer: string[]): string {
  if (o.requestedDeliveryDate) return o.requestedDeliveryDate
  return linjeDatoer.filter(Boolean).sort()[0] ?? ''
}

/**
 * Alle åbne ordrer for kunden på ÉN leveringsform, slået op pr. leveringsdato.
 * Er der flere på samme dato (fra før denne regel), vinder den ældste — det er
 * den pakkeriet kender.
 */
export async function aabneOrdrerPrDato(
  customerNo: string,
  shipmentMethodCode: string,
): Promise<Map<string, AabenOrdre>> {
  const kort = new Map<string, AabenOrdre>()
  if (!customerNo) return kort

  const ordrer = await getCustomerOrders(customerNo).catch(() => [] as BCCustomerOrder[])
  // Leveringsformen skal matche. Tom kode på ordren kan vi ikke henføre, og den
  // springes over frem for at blive gættet på plads.
  const relevante = ordrer.filter(o => (o.shipmentMethodCode || '') === (shipmentMethodCode || ''))
  if (relevante.length === 0) return kort

  await Promise.all(relevante.map(async (o) => {
    if (!o.number) return
    const linjer = await getPortalLineStatuses(o.number).catch(() => null)
    const lns = linjer ?? []
    const dato = datoFor(o, lns.map(l => l.shipmentDate))
    if (!dato) return

    const kandidat: AabenOrdre = {
      bcOrderId:     o.id,
      bcOrderNumber: o.number,
      dato,
      antalLinjer:   lns.filter(l => (l.lineObjectNumber ?? '').trim() !== '').length,
      beloeb:        o.amountIncludingTax ?? 0,
      pakket:        lns.some(l => (l.headerPackedBy ?? '').trim() !== ''),
      fraPortal:     o.number.startsWith('W'),
    }

    const findes = kort.get(dato)
    // Ældste vinder — men en UPAKKET slår en pakket, for det er den der kan udvides.
    if (!findes
        || (findes.pakket && !kandidat.pakket)
        || (findes.pakket === kandidat.pakket && kandidat.bcOrderNumber < findes.bcOrderNumber)) {
      kort.set(dato, kandidat)
    }
  }))

  return kort
}

/** Den åbne ordre for én bestemt dato, eller null. */
export async function findAabenOrdre(
  customerNo: string,
  dato: string,
  shipmentMethodCode: string,
): Promise<AabenOrdre | null> {
  if (!dato) return null
  const kort = await aabneOrdrerPrDato(customerNo, shipmentMethodCode)
  return kort.get(dato) ?? null
}
