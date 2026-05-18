import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getItemsByNumbers, getPortalPrices, getItemsAttributeValues, getItemsUoMs, getCustomerFavorites, getStandingOrderLines, getItemCutoffs, getItemCategories, getWebshopVisibleItemNos, getItemAvailabilities, getPortalShipmentMethods, getPortalCalendarDays, getCustomerShipmentMethodCode } from '@/lib/businesscentral'
import type { BCPortalPrice, BCItemAttributeValue, BCItemUoM } from '@/lib/businesscentral'
import OrderList from '@/components/portal/OrderList'
import { addBusinessDays, nextBusinessDays, getDeliveryDatesForMethod } from '@/lib/dateUtils'

export const dynamic = 'force-dynamic'

/** Finder visningspris for qty=1 — laveste pris på tværs af alle gældende priskilder. */
function startPrice(itemNo: string, prices: BCPortalPrice[], today: string): number | null {
  const applicable = prices.filter(
    (p) =>
      p.itemNo === itemNo &&
      p.minimumQuantity <= 1 &&
      (!p.startingDate || p.startingDate <= today) &&
      (!p.endingDate   || p.endingDate   >= today),
  )
  if (!applicable.length) return null
  return Math.min(...applicable.map(p => p.unitPrice))
}


export default async function BestilPage() {
  const session    = await getServerSession(authOptions)
  const userId     = (session?.user as any)?.id               as string
  const customerNo = (session?.user as any)?.bcCustomerNumber as string ?? ''
  const priceGrp   = (session?.user as any)?.bcPriceGroup     as string ?? ''
  const requirePoNumber = (session?.user as any)?.requirePoNumber as boolean ?? false

  // Grupper der altid kræver PO-nummer
  const PO_REQUIRED_GROUPS = ['Salling', 'COOP', 'salling', 'coop']
  const bookingGroup = (session?.user as any)?.bcDebitorBookingGroup as string ?? ''
  const needsPo = requirePoNumber || PO_REQUIRED_GROUPS.some(g => bookingGroup.toLowerCase().includes(g.toLowerCase()))

  const today     = new Date()
  const today8601 = today.toISOString().split('T')[0]

  // ── Hent alt parallelt ────────────────────────────────────────────────────────
  const [portalPrices, blockedRows, promoRows, dbFavRows, bcStandardLines, standingLines, itemCutoffs, allCategories, webshopVisible, itemAvailabilities, portalShipmentMethods, customerShipMethodCode] = await Promise.all([
    getPortalPrices(customerNo, priceGrp),
    prisma.blockedItem.findMany({ where: { customerId: userId } }),
    prisma.dailyPromotion.findMany({
      where: {
        date: {
          gte: new Date(today.toDateString()),
          lt:  addBusinessDays(new Date(today.toDateString()), 1),
        },
      },
      orderBy: { priority: 'desc' },
    }),
    prisma.favorite.findMany({ where: { customerId: userId } }),
    getCustomerFavorites(customerNo).catch(() => []),
    getStandingOrderLines(customerNo).catch(() => []),
    getItemCutoffs().catch(() => new Map()),
    getItemCategories().catch(() => []),
    getWebshopVisibleItemNos().catch(() => null),
    getItemAvailabilities().catch(() => new Map()),
    getPortalShipmentMethods().catch(() => []),
    getCustomerShipmentMethodCode(customerNo).catch(() => ''),
  ])

  const blockedSet = new Set(blockedRows.map((b) => b.bcItemNumber))
  // null = BC-fejl → vis alt. Set = filter aktiv (kun varer med RangeringPrisliste > 0)
  const visFilter = (n: string) => webshopVisible === null || webshopVisible.has(n)

  // Venmark-anbefalede varer — direkte fra BC felt 50008 "SaelgforH" på tabel 27
  const venmarkNos = new Set(
    Array.from(itemCutoffs.entries())
      .filter(([, v]) => v.saelgForH)
      .map(([itemNo]) => itemNo)
      .filter(n => !blockedSet.has(n) && !n.toUpperCase().startsWith('X') && visFilter(n))
  )

  // ── Favoritter: BC tabel 50157 er eneste master ──
  // Portalen læser KUN fra BC tabel 50157. Portal DB bruges kun til optimistiske writes (❤️-klik).
  // Fallback til portal DB hvis BC er utilgængeligt (bcStandardLines er tom pga. catch(() => [])).
  const bcStandardNos = new Set(bcStandardLines.map(l => l.itemNo))
  const dbFavNos      = new Set(dbFavRows.map(f => f.bcItemNumber))
  const favSource     = bcStandardNos.size > 0 ? bcStandardNos : dbFavNos
  const allFavNos     = Array.from(favSource)
    .filter(n => !blockedSet.has(n) && !n.toUpperCase().startsWith('X') && visFilter(n))

  const promoNumbers = promoRows
    .map((p) => p.bcItemNumber)
    .filter((n) => !blockedSet.has(n))

  // Faste ordrelinjer — varenumre der ikke er blokerede, ikke starter med X, og har RangeringPrisliste > 0
  const standingNos = standingLines
    .filter(l => !blockedSet.has(l.itemNo) && !l.itemNo.toUpperCase().startsWith('X') && visFilter(l.itemNo))
    .map(l => l.itemNo)

  const allNumbers = Array.from(new Set([...allFavNos, ...promoNumbers, ...Array.from(venmarkNos), ...standingNos]))

  // ── Hent varekortdetaljer + attributter + enheder fra BC parallelt ─────────
  const bcItems = await getItemsByNumbers(allNumbers)
  const itemRefs = bcItems.map(i => ({ id: i.id, number: i.number }))
  const [attrMap, uomMap] = await Promise.all([
    getItemsAttributeValues(itemRefs),
    getItemsUoMs(itemRefs),
  ])

  // Byg item-map med kundepris for qty=1 som startpris + attributter + enheder
  const itemMap = new Map(
    bcItems.map((item) => {
      const attrs = attrMap.get(item.number) ?? []

      // ── Brug faktiske BC-enheder inkl. korrekte konverteringsfaktorer ──────
      // Merges BC-enheder (har korrekte faktorer) med prislisteenheder (altid synlige)
      const bcUoms = uomMap.get(item.number) ?? []

      // Byg map: start med base-enhed, overskriv med BC-data, tilsæt prislisteenheder
      const uomByCode = new Map<string, BCItemUoM>()
      uomByCode.set(item.baseUnitOfMeasureCode, {
        code: item.baseUnitOfMeasureCode,
        displayName: item.baseUnitOfMeasureCode,
        qtyPerUnitOfMeasure: 1,
        baseUnitOfMeasure: true,
      })
      for (const u of bcUoms) uomByCode.set(u.code, u)
      // Tilsæt UoM'er fra prislisten der mangler i BC-data (faktor ukendt = 1)
      for (const p of portalPrices) {
        if (p.itemNo === item.number && p.unitOfMeasure && !uomByCode.has(p.unitOfMeasure)) {
          uomByCode.set(p.unitOfMeasure, {
            code: p.unitOfMeasure,
            displayName: p.unitOfMeasure,
            qtyPerUnitOfMeasure: 1,
            baseUnitOfMeasure: false,
          })
        }
      }
      const uoms: BCItemUoM[] = Array.from(uomByCode.values())

      return [
        item.number,
        {
          ...item,
          unitPrice:  startPrice(item.number, portalPrices, today8601) ?? item.unitPrice,
          attributes: attrs,
          uoms,
          pictureId:  item.picture?.id ?? null,
        },
      ]
    }),
  )

  // ── Byg lister ──────────────────────────────────────────────────────────────
  const promotions = promoRows
    .map((p) => ({ item: itemMap.get(p.bcItemNumber), note: p.note ?? '' }))
    .filter((p) => p.item != null) as { item: NonNullable<ReturnType<typeof itemMap.get>>; note: string }[]

  const favorites = allFavNos
    .map((n) => itemMap.get(n))
    .filter(Boolean) as NonNullable<ReturnType<typeof itemMap.get>>[]

  // Venmark-anbefalede varer fra BC felt 50008 — ikke vist hvis allerede i favoritter eller promos
  const allFavSet  = new Set(allFavNos)
  const venmarkItems = Array.from(venmarkNos)
    .filter(n => !promoRows.some(p => p.bcItemNumber === n)) // ikke promo
    .map(n => ({ item: itemMap.get(n), note: '' }))
    .filter(p => p.item != null) as { item: NonNullable<ReturnType<typeof itemMap.get>>; note: string }[]

  // Faste ordrelinjer med varekortdetaljer
  const standingOrders = standingLines
    .filter(l => !blockedSet.has(l.itemNo))
    .map(l => {
      const item = itemMap.get(l.itemNo)
      if (!item) return null
      return {
        id:            l.id,
        item,
        unitOfMeasure: l.unitOfMeasureCode || item.baseUnitOfMeasureCode,
        standingNote:  l.standingNote,
        qtyMonday:    l.qtyMonday,
        qtyTuesday:   l.qtyTuesday,
        qtyWednesday: l.qtyWednesday,
        qtyThursday:  l.qtyThursday,
        qtyFriday:    l.qtyFriday,
      }
    })
    .filter(Boolean) as {
      item: NonNullable<ReturnType<typeof itemMap.get>>
      unitOfMeasure: string
      qtyMonday: number; qtyTuesday: number; qtyWednesday: number; qtyThursday: number; qtyFriday: number
    }[]

  // ── Trappepriser til klient ─────────────────────────────────────────────────
  const priceTiers = portalPrices.map((p) => ({
    itemNo:          p.itemNo,
    minimumQuantity: p.minimumQuantity,
    unitPrice:       p.unitPrice,
    unitOfMeasure:   p.unitOfMeasure,
    startingDate:    p.startingDate,
    endingDate:      p.endingDate,
  }))

  // ── Leveringsdatoer baseret på kundens leveringsmetode ───────────────────────
  const toDate90 = new Date(today); toDate90.setDate(today.getDate() + 90)
  const calendarDays = await getPortalCalendarDays(today8601, toDate90.toISOString().split('T')[0]).catch(() => [])

  const customerMethod = portalShipmentMethods.find(m => m.code === customerShipMethodCode)
  const deliveryDays = customerMethod
    ? getDeliveryDatesForMethod(customerMethod, calendarDays, today, 20)
    : nextBusinessDays(today, 20)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ny bestilling</h1>
        <p className="mt-1 text-sm text-gray-500">
          Vælg leveringsdato og tilpas mængder
        </p>
      </div>

      <OrderList
        promotions={promotions as any}
        favorites={favorites as any}
        venmarkItems={venmarkItems as any}
        standingOrders={standingOrders as any}
        deliveryDays={deliveryDays}
        customerId={userId}
        priceTiers={priceTiers}
        initialFavNos={allFavNos}
        requirePoNumber={needsPo}
        itemCutoffs={itemCutoffs as any}
        allCategories={allCategories}
        itemAvailabilities={Object.fromEntries(itemAvailabilities)}
        shipmentMethods={portalShipmentMethods}
        customerShipmentMethodCode={customerShipMethodCode}
        calendarDays={calendarDays}
      />
    </div>
  )
}
