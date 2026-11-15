// Én ordre pr. leverance.
//
// Bestiller kunden to gange til samme leverance, skal den anden bestilling LÆGGES
// PÅ den første frem for at blive en ordre mere. Ellers ender pakkeriet med to
// sedler til samme bil, og kunden med to fakturaer. Vi har set en kunde med elleve
// åbne ordrer til samme dag.
//
// Undtagelsen er en ordre der allerede er PAKKET (Packed By sat på salgshovedet) —
// den kan ikke nå at få mere med, og så er en ny ordre det rigtige.
//
// Forskellig leveringsform samme dag er IKKE en dublet: enkelte kunder får to
// leveringer om dagen, tidlig og sen, og de skal holdes adskilt.

import { getCustomerOrders, getPortalLineStatuses } from '@/lib/businesscentral'
import type { BCCustomerOrder, BCShipmentMethod } from '@/lib/businesscentral'
import { getDispatchDateForMethodDelivery } from '@/lib/dateUtils'

export interface AabenOrdre {
  bcOrderId:     string
  bcOrderNumber: string
  /** AFSENDELSESdagen som YYYY-MM-DD — den dag ordren forlader Hirtshals. */
  afsendelsesdag: string
  antalLinjer:   number
  beloeb:        number
  /** Pakket = kan ikke udvides; kalderen skal oprette en ny ordre. */
  pakket:        boolean
  /** Falsk = tastet i BC (telefon/mail). Kunden skal stadig kunne lægge på den. */
  fraPortal:     boolean
}

/** YYYY-MM-DD i lokal tid — toISOString ville give dagen før i UTC+2. */
export function ymdLokal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Afsendelsesdagen for en leveringsdato — samme regnestykke som når ordren
 * oprettes (leveringsdato − transitdage). Eksporteret, fordi kalderne slår op på
 * den dato kunden VÆLGER, mens nøglen i BC er den dag varerne køres ud.
 */
export function afsendelsesdagForLevering(
  leveringsdato: string | Date,
  method: BCShipmentMethod | null | undefined,
): string {
  const d = typeof leveringsdato === 'string'
    ? new Date(`${leveringsdato}T00:00:00`)
    : leveringsdato
  if (Number.isNaN(d.getTime())) return typeof leveringsdato === 'string' ? leveringsdato : ''
  // Uden leveringsform kan vi ikke regne transitdage; så er leveringsdatoen det
  // bedste bud (gælder kun kunder uden leveringskode).
  if (!method) return ymdLokal(d)
  return ymdLokal(getDispatchDateForMethodDelivery(d, method))
}

/**
 * Ordrens AFSENDELSESDAG — den eneste dato BC faktisk har på en ordre, nemlig
 * salgslinjens "Afsendelsesdato". Leveringsdatoen er afledt (afsendelse +
 * transitdage) og står KUN på portal-oprettede ordrer; 88 af 113 åbne ordrer stod
 * uden "ønsket leveringsdato", fordi kontoret ikke udfylder den.
 *
 * DERFOR matcher vi på afsendelsesdagen og ikke på leveringsdatoen. Den modsatte
 * vej — ordrens afsendelsesdato regnet om til en leveringsdato — er flertydig:
 * en fredagsafsendelse med én transitdag dækker både lørdag og mandag.
 *
 * Det kostede en dublet 11-11-2026: kunden lagde 8 linjer på telefonordre 285602
 * kl. 09.35 (den stod dengang tilfældigvis med 12-11 i afsendelsesfeltet, så
 * datoerne passede), kontoret rettede den til den rigtige afsendelsesdag 11-11, og
 * kl. 11.10 kunne portalen ikke længere genkende ordren. Kunden fik W0000217 —
 * til nøjagtig samme bil.
 */
function afsendelsesdagFor(
  o: BCCustomerOrder,
  linjeDatoer: string[],
  method: BCShipmentMethod | null | undefined,
): string {
  // Linjernes egen afsendelsesdato er BC's facit — ingen omregning, intet gæt.
  const fraLinjer = linjeDatoer.filter(Boolean).sort()[0]
  if (fraLinjer) return fraLinjer
  // Tom ordre (ingen linjer endnu): regn ud fra ønsket leveringsdato, samme vej
  // som BC selv gjorde da ordren blev oprettet.
  if (o.requestedDeliveryDate) return afsendelsesdagForLevering(o.requestedDeliveryDate, method)
  return ''
}

/**
 * Alle åbne ordrer for kunden på ÉN leveringsform, slået op pr. AFSENDELSESDAG.
 * Er der flere på samme dag (fra før denne regel), vinder den ældste — det er
 * den pakkeriet kender.
 */
export async function aabneOrdrerPrAfsendelsesdag(
  customerNo: string,
  shipmentMethodCode: string,
  method: BCShipmentMethod | null | undefined,
  kunLeveringsdato?: string,
): Promise<Map<string, AabenOrdre>> {
  const kort = new Map<string, AabenOrdre>()
  if (!customerNo) return kort

  const ordrer = await getCustomerOrders(customerNo, kunLeveringsdato).catch(() => [] as BCCustomerOrder[])
  // Leveringsformen skal matche. Tom kode på ordren kan vi ikke henføre, og den
  // springes over frem for at blive gættet på plads.
  const relevante = ordrer.filter(o => (o.shipmentMethodCode || '') === (shipmentMethodCode || ''))
  if (relevante.length === 0) return kort

  await Promise.all(relevante.map(async (o) => {
    if (!o.number) return
    // Søges der kun én dato (bestilling), kan en ordre med en ANDEN ønsket leveringsdato
    // aldrig matche → spring linje-opslaget over. Kun ordrer UDEN ønsket leveringsdato
    // (BC-tastede) skal have linjerne hentet. Sparede 4-7 s pr. bestilling hos kunder
    // med mange åbne ordrer.
    if (kunLeveringsdato && o.requestedDeliveryDate && o.requestedDeliveryDate !== kunLeveringsdato) return
    // Frisk: et cachet (evt. timer gammelt) linjebillede gav W0000224 ved siden af 285776.
    const linjer = await getPortalLineStatuses(o.number, { frisk: true }).catch(() => null)
    const lns = linjer ?? []
    const afsendelsesdag = afsendelsesdagFor(o, lns.map(l => l.shipmentDate), method)
    if (!afsendelsesdag) return

    const kandidat: AabenOrdre = {
      bcOrderId:     o.id,
      bcOrderNumber: o.number,
      afsendelsesdag,
      antalLinjer:   lns.filter(l => (l.lineObjectNumber ?? '').trim() !== '').length,
      beloeb:        o.amountIncludingTax ?? 0,
      pakket:        lns.some(l => (l.headerPackedBy ?? '').trim() !== ''),
      fraPortal:     o.number.startsWith('W'),
    }

    const findes = kort.get(afsendelsesdag)
    // Ældste vinder — men en UPAKKET slår en pakket, for det er den der kan udvides.
    if (!findes
        || (findes.pakket && !kandidat.pakket)
        || (findes.pakket === kandidat.pakket && kandidat.bcOrderNumber < findes.bcOrderNumber)) {
      kort.set(afsendelsesdag, kandidat)
    }
  }))

  return kort
}

/** Den åbne ordre for én bestemt LEVERINGSdato, eller null. */
export async function findAabenOrdre(
  customerNo: string,
  leveringsdato: string,
  shipmentMethodCode: string,
  method: BCShipmentMethod | null | undefined,
): Promise<AabenOrdre | null> {
  if (!leveringsdato) return null
  const kort = await aabneOrdrerPrAfsendelsesdag(customerNo, shipmentMethodCode, method, leveringsdato)
  const noegle = afsendelsesdagForLevering(leveringsdato, method)
  const fundet = kort.get(noegle) ?? null
  // Spor når der ER åbne ordrer på leveringsformen, men ingen på dagen — så kan en "hvorfor
  // blev de ikke slået sammen?" besvares fra pm2-loggen i stedet for ved gætteri.
  if (!fundet && kort.size > 0) {
    console.log(`[aaben-ordre] ${customerNo} lev ${leveringsdato} [${shipmentMethodCode}] → afsendelse ${noegle}: intet match blandt`,
      Array.from(kort.values()).map(o => `${o.bcOrderNumber}@${o.afsendelsesdag}`).join(', '))
  }
  return fundet
}
