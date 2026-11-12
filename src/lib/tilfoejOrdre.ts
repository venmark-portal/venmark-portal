// "Tilføj vare til denne ordre" — opslag af den ordre der skal tilføjes til.
//
// Knappen fandtes før KUN på ordrer bestilt gennem portalen, fordi hele vejen hang på
// en række i portalens egen Order-tabel. Men kunden skelner ikke: har hun ringet en
// ordre ind om morgenen og kommer i tanke om en bakke rødspætte, er det samme ønske.
// Ordrer tastet i BC har ingen portalrække, og så var der ingen knap.
//
// Derfor denne: den slår ordren op BEGGE veje og svarer med det samme, uanset hvor
// ordren kom fra. Side og API bruger samme funktion, så de ikke kan blive uenige om
// hvad kunden må — det er præcis dér et "knappen var der, men den sagde nej" opstår.

import { prisma } from '@/lib/prisma'
import {
  getCustomerOrders, getPortalOrderAccesses, getPortalShipmentMethods, getPortalCalendarDays,
  getPortalLineStatuses,
} from '@/lib/businesscentral'
import type { BCCustomerOrder, BCShipmentMethod } from '@/lib/businesscentral'
import {
  getDeadlineForMethodDelivery, getDeadlineForDelivery, getDeliveryDateForMethodDispatch, getDispatchDateForMethodDelivery,
} from '@/lib/dateUtils'

export interface TilfoejMaal {
  /** BC's salgsordre-id (GUID) — det linjerne skal hænges på. */
  bcOrderId:     string
  bcOrderNumber: string
  deliveryDate:  Date
  /** Hvornår man senest kan nå at tilføje. */
  deadline:      Date
  /** Portalens egen ordre-id — null når ordren er tastet i BC. */
  portalOrderId: string | null
  /** Debitornummeret ordren står på (kan være en butik man bestiller for). */
  customerNo:    string
  /**
   * Ordrens leveringsform (BC). Antals-loftet afhænger af den: en tidlig "Hentes kl."
   * pakkes dagen før, en sen samme dag — og et indkøb der lander om morgenen tæller kun
   * med i det sidste tilfælde. Tom = ukendt.
   */
  shipmentMethodCode: string
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Finder ordren ud fra id'et i adressen. Id'et er ENTEN portalens eget ordre-id
 * ELLER BC's salgsordre-GUID — de to kan ikke forveksles, og kunden skal ikke skulle
 * vide hvilken slags ordre hun kigger på.
 *
 * Null = findes ikke, eller hører ikke til denne kunde. Vi skelner ikke udadtil.
 */
// Fristen står ikke på en BC-ordre — den regnes af leveringsdato + leveringsform, præcis
// som på bestillingssiden. Uden kendt leveringsform falder vi tilbage til standardreglen.
async function beregnFrist(levering: Date, shipmentMethodCode: string): Promise<Date> {
  const om90 = new Date(); om90.setDate(om90.getDate() + 90)
  const [metoder, kalender] = await Promise.all([
    getPortalShipmentMethods().catch(() => []),
    getPortalCalendarDays(ymd(new Date()), ymd(om90)).catch(() => []),
  ])
  const metode = metoder.find(m => m.code === shipmentMethodCode)
  return metode
    ? getDeadlineForMethodDelivery(levering, metode, kalender)
    : getDeadlineForDelivery(levering)
}

/**
 * Leveringsdatoen for en BC-ordre (YYYY-MM-DD). Ønsket leveringsdato når den er sat; ellers
 * regnet fra linjernes AFSENDELSESdato — den eneste dato kontoret udfylder på en tlf-ordre —
 * plus leveringsformens transitdage. Ordreoversigten og tilføj-siden bruger begge denne.
 */
export function bcOrdreLevering(
  o: BCCustomerOrder,
  linjeAfsendelser: (string | null | undefined)[],
  metoder: BCShipmentMethod[],
): string {
  if (o.requestedDeliveryDate) return o.requestedDeliveryDate
  const afs = linjeAfsendelser.filter((d): d is string => !!d).sort()[0] ?? ''
  const m = metoder.find(x => x.code === o.shipmentMethodCode)
  if (!afs || !m) return afs
  return ymd(getDeliveryDateForMethodDispatch(new Date(`${afs}T00:00:00`), m))
}

/**
 * Fristen for at tilføje til en ordre TASTET I BC = udgangen af afsendelsesdagen. Kontoret
 * overrider leveringsformens klokkeslæt i telefonen hele tiden, så her gælder kun DAGEN
 * (Claus 12-11-2026). Spærringen efter det er "Packed By" på salgshovedet, som før.
 * Afsendelsesdagen = linjernes tidligste afsendelsesdato; tom ordre → regnet fra ønsket
 * leveringsdato − transitdage. Null = ingen dato at gå efter.
 */
export function bcOrdreFrist(
  o: BCCustomerOrder,
  linjeAfsendelser: (string | null | undefined)[],
  metoder: BCShipmentMethod[],
): Date | null {
  const afs = linjeAfsendelser.filter((d): d is string => !!d).sort()[0]
  let dag: Date | null = afs ? new Date(`${afs}T00:00:00`) : null
  if (!dag && o.requestedDeliveryDate) {
    const lev = new Date(`${o.requestedDeliveryDate}T00:00:00`)
    const m = metoder.find(x => x.code === o.shipmentMethodCode)
    dag = m ? getDispatchDateForMethodDelivery(lev, m) : lev
  }
  if (!dag || Number.isNaN(dag.getTime())) return null
  dag.setHours(23, 59, 59, 999)
  return dag
}

export async function findTilfoejMaal(
  id: string,
  session: any,
): Promise<TilfoejMaal | null> {
  if (!id) return null
  const userId = session?.user?.id as string | undefined
  if (!userId) return null

  // ── 1. Portalens egen ordre ──────────────────────────────────────────────
  const portalOrdre = await prisma.order.findUnique({ where: { id } }).catch(() => null)
  if (portalOrdre) {
    if (portalOrdre.customerId !== userId) return null
    if (portalOrdre.status === 'REJECTED') return null
    if (!portalOrdre.bcOrderId) return null   // endnu ikke i BC → intet at hænge linjer på
    const custNo = (session.user as any)?.bcCustomerNumber ?? ''
    // BC-ordren er facit for leveringsform OG dato: flyttes ordren i BC, skal tilføj-siden
    // følge med (portalens Order-række husker kun datoen fra bestillingen). Findes BC-ordren
    // ikke (fx BC nede), bruges portalens egne tal som før.
    const bcListe = custNo ? await getCustomerOrders(custNo).catch(() => []) : []
    const bcOrdre = bcListe.find(o => o.id === portalOrdre.bcOrderId)
    // Kontoret samler ofte kundens W-ordrer i én BC-ordre og sletter W-ordren (Farum,
    // W0000103 → 284426, 22-10-2026). Portalens række ved det ikke, så "Tilføj vare" prøvede
    // et BC-id der ikke findes → "No document with the specified ID exists" på hver linje.
    // Kunne vi hente kundens ordrer (listen er ikke tom), men er denne væk → den findes ikke
    // længere. Tom liste = BC-fejl eller ingen ordrer → gammel adfærd (fallback).
    if (bcListe.length > 0 && !bcOrdre) return null
    let levering = new Date(portalOrdre.deliveryDate)
    let deadline = new Date(portalOrdre.deadline)
    if (bcOrdre?.requestedDeliveryDate) {
      const bcLevering = new Date(`${bcOrdre.requestedDeliveryDate}T00:00:00`)
      if (ymd(bcLevering) !== ymd(levering)) {
        levering = bcLevering
        deadline = await beregnFrist(levering, bcOrdre.shipmentMethodCode ?? '')
      }
    }
    return {
      bcOrderId:     portalOrdre.bcOrderId,
      bcOrderNumber: portalOrdre.bcOrderNumber ?? '',
      deliveryDate:  levering,
      deadline,
      portalOrderId: portalOrdre.id,
      customerNo:    custNo,
      shipmentMethodCode: bcOrdre?.shipmentMethodCode ?? '',
    }
  }

  // ── 2. Ordre tastet i BC ─────────────────────────────────────────────────
  // Ejerskabet afgøres af at ordren står på et debitornummer kunden må bestille for.
  // Vi leder i de samme lister som ordreoversigten viser — er den ikke dér, er den
  // ikke hendes.
  const parentNo = (session.user as any)?.parentCustomerNumber
    ?? (session.user as any)?.bcCustomerNumber ?? ''
  if (!parentNo) return null

  const butikker = await getPortalOrderAccesses(parentNo).catch(() => [])
  const numre = Array.from(new Set([parentNo, ...butikker.map(b => b.customerNo)].filter(Boolean)))

  let fundet: Awaited<ReturnType<typeof getCustomerOrders>>[number] | null = null
  for (const nr of numre) {
    const ordrer = await getCustomerOrders(nr).catch(() => [])
    const match = ordrer.find(o => o.id === id)
    if (match) { fundet = match; break }
  }
  if (!fundet) return null

  // Tlf-ordrer har sjældent ønsket leveringsdato → regnes fra linjernes afsendelsesdato.
  // Fristen er hele afsendelsesdagen, ikke leveringsformens klokkeslæt (se bcOrdreFrist).
  const [linjer, metoder] = await Promise.all([
    getPortalLineStatuses(fundet.number).catch(() => null),
    getPortalShipmentMethods().catch(() => [] as BCShipmentMethod[]),
  ])
  const afsendelser = (linjer ?? []).map(l => l.shipmentDate)
  const levDato  = bcOrdreLevering(fundet, afsendelser, metoder)
  const deadline = bcOrdreFrist(fundet, afsendelser, metoder)
  if (!levDato || !deadline) return null

  const levering = new Date(`${levDato}T00:00:00`)

  return {
    bcOrderId:     fundet.id,
    bcOrderNumber: fundet.number,
    deliveryDate:  levering,
    deadline,
    portalOrderId: null,
    customerNo:    fundet.customerNumber,
    shipmentMethodCode: fundet.shipmentMethodCode ?? '',
  }
}
