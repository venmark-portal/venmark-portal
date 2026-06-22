import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getItemsByNumbers, getPortalPrices, getItemsAttributeValues, getItemsUoMs, getCustomerFavorites, getStandingOrderLines, getItemCutoffs, getItemCategories, getWebshopVisibleItemNos, getItemAvailabilities, getPortalShipmentMethods, getPortalCalendarDays, getCustomerShipmentMethodCode, getCustomerPortalShipmentMethods, getAverageSalesPriceForItems } from '@/lib/businesscentral'
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
      (!p.endingDate   || p.endingDate.startsWith('0001') || p.endingDate   >= today),
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
  const toDate90  = new Date(today); toDate90.setDate(today.getDate() + 90)
  const toDate90str = toDate90.toISOString().split('T')[0]

  // ── Hent alt parallelt ────────────────────────────────────────────────────────
  // Kalenderen hentes nu HER (afhænger kun af datoer) i stedet for et separat,
  // sekventielt kald senere — sparer én BC-runde-tur i page-load.
  const [portalPrices, blockedRows, promoRows, dbFavRows, bcStandardLines, standingLines, itemCutoffs, allCategories, webshopVisible, itemAvailabilities, portalShipmentMethods, customerShipMethodCode, customerAllowedCodes, calendarDays] = await Promise.all([
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
    getCustomerPortalShipmentMethods(customerNo).catch(() => []),
    getPortalCalendarDays(today8601, toDate90str).catch(() => []),
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
  // STD-favoritter (Standard Favorite = true) vises øverst som egen sektion.
  //
  // Filtreringsregel:
  //   STD: vises uanset rangliste/pris (kun blokerede + X-prefiks udelukkes)
  //   Almindelig favorit: udelukkes hvis ikke på rangliste (visFilter) eller uden pris
  const hardFilterFav = (n: string) =>
    !blockedSet.has(n) && !n.toUpperCase().startsWith('X')
  const regularFavFilter = (n: string) =>
    hardFilterFav(n) && visFilter(n)

  const bcStdLines      = bcStandardLines.filter(l => l.standardFavorite)
  const bcRegularLines  = bcStandardLines.filter(l => !l.standardFavorite)
  const bcStdNos        = new Set(bcStdLines.map(l => l.itemNo))
  const bcRegularNos    = new Set(bcRegularLines.map(l => l.itemNo))
  const dbFavNos        = new Set(dbFavRows.map(f => f.bcItemNumber))

  // STD-favoritter findes kun i BC (portal DB har ikke STD-flaget endnu)
  const stdFavNos       = Array.from(bcStdNos).filter(hardFilterFav)
  // Almindelige favoritter: BC først, ellers DB (uden dem der er STD)
  const customerFavSrc  = bcRegularNos.size > 0 || bcStdNos.size > 0 ? bcRegularNos : dbFavNos
  const customerFavNos  = Array.from(customerFavSrc)
    .filter(n => !bcStdNos.has(n) && regularFavFilter(n))

  // Bagudkompatibilitet — allFavNos bruges flere steder til "denne vare er en favorit" (uden STD-skel)
  const allFavNos       = [...stdFavNos, ...customerFavNos]
  const stdFavSet       = new Set(stdFavNos)
  const customerFavSet  = new Set(customerFavNos)

  const promoNumbers = promoRows
    .map((p) => p.bcItemNumber)
    .filter((n) => !blockedSet.has(n) && visFilter(n))

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

  // STD-favoritter (allerøverst — Standard Favorite = true på BC)
  const stdFavorites = stdFavNos
    .map((n) => itemMap.get(n))
    .filter(Boolean) as NonNullable<ReturnType<typeof itemMap.get>>[]

  // Kundens egne favoritter — kun dem der IKKE er STD (de er allerede i stdFavorites)
  // Filtrér også varer uden pris bort (STD vises uanset; almindelige favoritter skjules)
  const favorites = customerFavNos
    .map((n) => itemMap.get(n))
    .filter((i): i is NonNullable<ReturnType<typeof itemMap.get>> => i != null && (i.unitPrice ?? 0) > 0)

  // Venmark-anbefalede (SaelgForH) — kun dem der IKKE allerede er STD eller kundens favorit.
  // Sikrer at hver vare kun vises én gang på siden, i sin højest-prioriterede sektion.
  const promoNoSet = new Set(promoRows.map(p => p.bcItemNumber))
  const venmarkItems = Array.from(venmarkNos)
    .filter(n => !stdFavSet.has(n) && !customerFavSet.has(n) && !promoNoSet.has(n))
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

  // ── Leveringsdatoer + kundespecifikke metoder ────────────────────────────────
  // (calendarDays hentes nu parallelt øverst sammen med resten.)

  // Kundespecifikke metoder fra BC-undertabellen (rækkefølge bevares)
  // Fallback: kundens standard-leveringsmetode fra kundekort
  const allowedMethods = customerAllowedCodes.length > 0
    ? portalShipmentMethods.filter(m => customerAllowedCodes.includes(m.code))
    : portalShipmentMethods.filter(m => m.code === customerShipMethodCode)

  const customerMethod = allowedMethods[0] ?? portalShipmentMethods.find(m => m.code === customerShipMethodCode)
  const rawDeliveryDays = customerMethod
    ? getDeliveryDatesForMethod(customerMethod, calendarDays, today, 20)
    : []
  // Fallback: hvis BC-leveringsmetode ikke har konfigurerede ugedage, brug næste hverdage
  const deliveryDays = rawDeliveryDays.length > 0 ? rawDeliveryDays : nextBusinessDays(today, 20)

  // Estimerede priser: gennemsnit af seneste 10 salg for varer uden aftalt pris
  const zeroPriceNos = allNumbers.filter(n => (itemMap.get(n)?.unitPrice ?? 0) === 0)
  const estimatedPrices = zeroPriceNos.length > 0
    ? await getAverageSalesPriceForItems(customerNo, zeroPriceNos).catch(() => new Map<string, number>())
    : new Map<string, number>()

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
        stdFavorites={stdFavorites as any}
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
        shipmentMethods={allowedMethods.length > 0 ? allowedMethods : (customerMethod ? [customerMethod] : [])}
        customerShipmentMethodCode={customerMethod?.code ?? ''}
        calendarDays={calendarDays}
        estimatedPrices={Object.fromEntries(estimatedPrices)}
      />
    </div>
  )
}
