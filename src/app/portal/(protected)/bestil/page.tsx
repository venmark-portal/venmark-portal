import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getItemsByNumbers, getPortalPrices, getItemsAttributeValues, getItemsUoMs } from '@/lib/businesscentral'
import type { BCPortalPrice, BCItemAttributeValue, BCItemUoM } from '@/lib/businesscentral'
import OrderList from '@/components/portal/OrderList'
import { addBusinessDays, nextBusinessDays } from '@/lib/dateUtils'

export const dynamic = 'force-dynamic'

/** Finder visningspris for qty=1 (laveste gyldig tier). */
function startPrice(itemNo: string, prices: BCPortalPrice[], today: string): number | null {
  const tiers = prices
    .filter(
      (p) =>
        p.itemNo === itemNo &&
        p.minimumQuantity <= 1 &&
        (!p.startingDate || p.startingDate <= today) &&
        (!p.endingDate   || p.endingDate   >= today),
    )
    .sort((a, b) => b.minimumQuantity - a.minimumQuantity)
  return tiers[0]?.unitPrice ?? null
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

  // ── Hent BC-priser + blokerede varer + anbefalinger + DB-favoritter parallelt ──
  const [portalPrices, blockedRows, promoRows, dbFavRows, venmarkRows] = await Promise.all([
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
    prisma.$queryRaw<{ bcItemNumber: string; priority: number; note: string | null }[]>`
      SELECT bcItemNumber, priority, note FROM VenmarkRecommended WHERE isActive = 1 ORDER BY priority DESC
    `,
  ])

  const blockedSet = new Set(blockedRows.map((b) => b.bcItemNumber))

  // Venmark-anbefalede varer ("sælg for helvede")
  const venmarkNos = new Set(
    venmarkRows.map(v => v.bcItemNumber).filter(n => !blockedSet.has(n))
  )

  // ── Merged favoritter: BC prislistelinje portalFavorite=true ELLER portal DB ──
  const bcFavNos  = new Set(portalPrices.filter(p => p.portalFavorite).map(p => p.itemNo))
  const dbFavNos  = new Set(dbFavRows.map(f => f.bcItemNumber))
  const allFavNos = Array.from(new Set([...Array.from(bcFavNos), ...Array.from(dbFavNos)])).filter(n => !blockedSet.has(n))

  const promoNumbers = promoRows
    .map((p) => p.bcItemNumber)
    .filter((n) => !blockedSet.has(n))

  const allNumbers = Array.from(new Set([...allFavNos, ...promoNumbers, ...Array.from(venmarkNos)]))

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

  // Venmark-anbefalede varer (flettes med favoritter — kun dem der ikke allerede er favoritter/promos)
  const venmarkItems = Array.from(venmarkNos)
    .filter(n => !promoRows.some(p => p.bcItemNumber === n)) // ikke promo
    .map(n => ({ item: itemMap.get(n), note: venmarkRows.find(v => v.bcItemNumber === n)?.note ?? '' }))
    .filter(p => p.item != null) as { item: NonNullable<ReturnType<typeof itemMap.get>>; note: string }[]

  // ── Trappepriser til klient ─────────────────────────────────────────────────
  const priceTiers = portalPrices.map((p) => ({
    itemNo:          p.itemNo,
    minimumQuantity: p.minimumQuantity,
    unitPrice:       p.unitPrice,
    unitOfMeasure:   p.unitOfMeasure,
    startingDate:    p.startingDate,
    endingDate:      p.endingDate,
  }))

  const deliveryDays = nextBusinessDays(today, 20)

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
        deliveryDays={deliveryDays}
        customerId={userId}
        priceTiers={priceTiers}
        initialFavNos={allFavNos}
        requirePoNumber={needsPo}
      />
    </div>
  )
}
