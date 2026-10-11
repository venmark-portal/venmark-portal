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
} from '@/lib/businesscentral'
import { getDeadlineForMethodDelivery, getDeadlineForDelivery } from '@/lib/dateUtils'

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
    return {
      bcOrderId:     portalOrdre.bcOrderId,
      bcOrderNumber: portalOrdre.bcOrderNumber ?? '',
      deliveryDate:  new Date(portalOrdre.deliveryDate),
      deadline:      new Date(portalOrdre.deadline),
      portalOrderId: portalOrdre.id,
      customerNo:    (session.user as any)?.bcCustomerNumber ?? '',
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
  if (!fundet || !fundet.requestedDeliveryDate) return null

  const levering = new Date(`${fundet.requestedDeliveryDate}T00:00:00`)

  // Fristen står ikke på en BC-ordre — den regnes af leveringsformen, præcis som på
  // bestillingssiden. Uden kendt leveringsform falder vi tilbage til standardreglen.
  const om90 = new Date(); om90.setDate(om90.getDate() + 90)
  const [metoder, kalender] = await Promise.all([
    getPortalShipmentMethods().catch(() => []),
    getPortalCalendarDays(ymd(new Date()), ymd(om90)).catch(() => []),
  ])
  const metode = metoder.find(m => m.code === fundet!.shipmentMethodCode)
  const deadline = metode
    ? getDeadlineForMethodDelivery(levering, metode, kalender)
    : getDeadlineForDelivery(levering)

  return {
    bcOrderId:     fundet.id,
    bcOrderNumber: fundet.number,
    deliveryDate:  levering,
    deadline,
    portalOrderId: null,
    customerNo:    fundet.customerNumber,
  }
}
