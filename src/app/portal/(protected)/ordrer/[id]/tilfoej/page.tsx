import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import {
  getItemsByNumbers, getPortalPrices, pickPriceBySource, getItemsAttributeValues, getItemsUoMs,
  getCustomerFavorites, getItemCutoffs, getItemCategories, getWebshopVisibleItemNos,
  getItemAvailabilities, getCustomerLocationCode,
} from '@/lib/businesscentral'
import type { BCPortalPrice, BCItemUoM } from '@/lib/businesscentral'
import OrderList from '@/components/portal/OrderList'

export const dynamic = 'force-dynamic'

// Visningspris for qty=1 — kilde-prioriteret (kunde > kæde > gruppe/alle). Spejler bestil-siden.
function startPrice(itemNo: string, prices: BCPortalPrice[], today: string): number | null {
  const applicable = prices.filter(
    (p) =>
      p.itemNo === itemNo &&
      p.minimumQuantity <= 1 &&
      (!p.startingDate || p.startingDate <= today) &&
      (!p.endingDate   || p.endingDate.startsWith('0001') || p.endingDate   >= today),
  )
  return pickPriceBySource(applicable)
}

// "Tilføj vare" = fuld kopi af bestil-siden (OrderList i add-mode), men leveringsdato/-form + PO
// er låst til den eksisterende ordre, og indsend lægger linjer på ordren i stedet for at oprette ny.
export default async function TilfoejVarePage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')

  const userId     = (session.user as any).id                as string
  const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''
  const priceGrp   = (session.user as any)?.bcPriceGroup     as string ?? ''
  const chainGrp   = (session.user as any)?.bcChainPriceGroup as string ?? ''

  const order = await prisma.order.findUnique({ where: { id: params.id }, include: { lines: true } })
  if (!order || order.customerId !== userId) redirect('/portal/ordrer')
  if (new Date() > new Date(order.deadline))  redirect('/portal/ordrer')
  if (order.status === 'REJECTED')            redirect('/portal/ordrer')

  const today     = new Date()
  const today8601 = today.toISOString().split('T')[0]

  const custLocation = await getCustomerLocationCode(customerNo).catch(() => '')

  // Samme katalogdata som bestil-siden (favoritter, Venmark-anbefaler, kategorier, cutoffs, priser)
  const [portalPrices, blockedRows, dbFavRows, bcStandardLines, itemCutoffs, allCategories, webshopVisible] = await Promise.all([
    getPortalPrices(customerNo, priceGrp, chainGrp),
    prisma.blockedItem.findMany({ where: { customerId: userId } }),
    prisma.favorite.findMany({ where: { customerId: userId } }),
    getCustomerFavorites(customerNo).catch(() => []),
    getItemCutoffs().catch(() => new Map()),
    getItemCategories().catch(() => []),
    getWebshopVisibleItemNos().catch(() => null),
  ])

  const blockedSet = new Set(blockedRows.map((b) => b.bcItemNumber))
  const visFilter  = (n: string) => webshopVisible === null || webshopVisible.has(n)

  const venmarkNos = new Set(
    Array.from(itemCutoffs.entries())
      .filter(([, v]) => v.saelgForH)
      .map(([itemNo]) => itemNo)
      .filter(n => !blockedSet.has(n) && !n.toUpperCase().startsWith('X') && visFilter(n)),
  )

  const hardFilterFav    = (n: string) => !blockedSet.has(n) && !n.toUpperCase().startsWith('X')
  const regularFavFilter = (n: string) => hardFilterFav(n) && visFilter(n)

  const bcStdLines     = bcStandardLines.filter(l => l.standardFavorite)
  const bcRegularLines = bcStandardLines.filter(l => !l.standardFavorite)
  const bcStdNos       = new Set(bcStdLines.map(l => l.itemNo))
  const bcRegularNos   = new Set(bcRegularLines.map(l => l.itemNo))
  const dbFavNos       = new Set(dbFavRows.map(f => f.bcItemNumber))

  const stdFavNos      = Array.from(bcStdNos).filter(hardFilterFav)
  const customerFavSrc = bcRegularNos.size > 0 || bcStdNos.size > 0 ? bcRegularNos : dbFavNos
  const customerFavNos = Array.from(customerFavSrc).filter(n => !bcStdNos.has(n) && regularFavFilter(n))

  const allFavNos      = [...stdFavNos, ...customerFavNos]
  const stdFavSet      = new Set(stdFavNos)
  const customerFavSet = new Set(customerFavNos)

  const allNumbers = Array.from(new Set([...allFavNos, ...Array.from(venmarkNos)]))

  const [bcItems, itemAvailabilities] = await Promise.all([
    getItemsByNumbers(allNumbers),
    getItemAvailabilities(custLocation, allNumbers).catch(() => new Map()),
  ])
  const itemRefs = bcItems.map(i => ({ id: i.id, number: i.number }))
  const [attrMap, uomMap] = await Promise.all([
    getItemsAttributeValues(itemRefs),
    getItemsUoMs(itemRefs),
  ])

  const itemMap = new Map(
    bcItems.map((item) => {
      const attrs  = attrMap.get(item.number) ?? []
      const bcUoms = uomMap.get(item.number) ?? []
      const uomByCode = new Map<string, BCItemUoM>()
      uomByCode.set(item.baseUnitOfMeasureCode, {
        code: item.baseUnitOfMeasureCode, displayName: item.baseUnitOfMeasureCode,
        qtyPerUnitOfMeasure: 1, baseUnitOfMeasure: true,
      })
      for (const u of bcUoms) uomByCode.set(u.code, u)
      for (const p of portalPrices) {
        if (p.itemNo === item.number && p.unitOfMeasure && !uomByCode.has(p.unitOfMeasure)) {
          uomByCode.set(p.unitOfMeasure, {
            code: p.unitOfMeasure, displayName: p.unitOfMeasure,
            qtyPerUnitOfMeasure: 1, baseUnitOfMeasure: false,
          })
        }
      }
      const uoms: BCItemUoM[] = Array.from(uomByCode.values())
      return [
        item.number,
        { ...item, unitPrice: startPrice(item.number, portalPrices, today8601) ?? item.unitPrice, attributes: attrs, uoms, pictureId: item.picture?.id ?? null },
      ]
    }),
  )

  const stdFavorites = stdFavNos
    .map((n) => itemMap.get(n))
    .filter(Boolean) as NonNullable<ReturnType<typeof itemMap.get>>[]
  const favorites = customerFavNos
    .map((n) => itemMap.get(n))
    .filter((i): i is NonNullable<ReturnType<typeof itemMap.get>> => i != null)
  const venmarkItems = Array.from(venmarkNos)
    .filter(n => !stdFavSet.has(n) && !customerFavSet.has(n))
    .map(n => ({ item: itemMap.get(n), note: '' }))
    .filter(p => p.item != null) as { item: NonNullable<ReturnType<typeof itemMap.get>>; note: string }[]

  const priceTiers = portalPrices.map((p) => ({
    itemNo: p.itemNo, minimumQuantity: p.minimumQuantity, unitPrice: p.unitPrice,
    unitOfMeasure: p.unitOfMeasure, startingDate: p.startingDate, endingDate: p.endingDate, sourcePriority: p.sourcePriority,
  }))

  const zeroPriceNos = allNumbers.filter(n => (itemMap.get(n)?.unitPrice ?? 0) === 0)

  const deliveryLabel = new Date(order.deliveryDate).toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'short',
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tilføj vare til ordre</h1>
        <p className="mt-1 text-sm text-gray-500">
          Levering {deliveryLabel}
          {order.bcOrderNumber && <span className="ml-1 font-mono">#{order.bcOrderNumber}</span>}
        </p>
      </div>

      <OrderList
        promotions={[]}
        stdFavorites={stdFavorites as any}
        favorites={favorites as any}
        venmarkItems={venmarkItems as any}
        standingOrders={[]}
        deliveryDays={[new Date(order.deliveryDate)]}
        customerId={userId}
        priceTiers={priceTiers}
        initialFavNos={allFavNos}
        requirePoNumber={false}
        itemCutoffs={itemCutoffs as any}
        allCategories={allCategories}
        itemAvailabilities={Object.fromEntries(itemAvailabilities)}
        shipmentMethods={[]}
        customerShipmentMethodCode=""
        calendarDays={[]}
        estimatedPrices={{}}
        zeroPriceNos={zeroPriceNos}
        addToOrderId={order.id}
        addBcOrderNumber={order.bcOrderNumber ?? undefined}
        addDeadline={order.deadline.toISOString()}
      />
    </div>
  )
}
