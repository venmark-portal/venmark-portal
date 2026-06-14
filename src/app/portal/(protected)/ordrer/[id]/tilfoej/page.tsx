import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import {
  getPortalPrices, getItemsByNumbers, getCustomerFavorites,
  getItemCutoffs, getWebshopVisibleItemNos, getItemsAttributeValues, getItemsUoMs,
  getItemAvailabilities,
} from '@/lib/businesscentral'
import type { BCPortalPrice, BCItemUoM } from '@/lib/businesscentral'
import AddLinesClient from './AddLinesClient'

export const dynamic = 'force-dynamic'

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

export default async function TilfoejVarePage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')

  const customerId = (session.user as any).id
  const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''
  const priceGrp   = (session.user as any)?.bcPriceGroup     as string ?? ''

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { lines: true },
  })

  if (!order || order.customerId !== customerId) redirect('/portal/ordrer')
  if (new Date() > new Date(order.deadline))   redirect('/portal/ordrer')
  if (order.status === 'REJECTED')             redirect('/portal/ordrer')

  // Varer der allerede er på ordren — udelukkes fra "tilføj"-listen
  const existingNos = new Set(order.lines.map(l => l.bcItemNumber))

  const today8601 = new Date().toISOString().split('T')[0]

  // ── Hent samme data som bestil-siden parallelt ──
  const [portalPrices, blockedRows, bcStandardLines, dbFavRows, itemCutoffs, webshopVisible, itemAvailabilities] = await Promise.all([
    getPortalPrices(customerNo, priceGrp),
    prisma.blockedItem.findMany({ where: { customerId } }),
    getCustomerFavorites(customerNo).catch(() => []),
    prisma.favorite.findMany({ where: { customerId } }),
    getItemCutoffs().catch(() => new Map()),
    getWebshopVisibleItemNos().catch(() => null),
    getItemAvailabilities().catch(() => new Map()),
  ])

  const blockedSet = new Set(blockedRows.map((b) => b.bcItemNumber))
  const visFilter = (n: string) => webshopVisible === null || webshopVisible.has(n)

  const hardFilterFav    = (n: string) => !blockedSet.has(n) && !n.toUpperCase().startsWith('X')
  const regularFavFilter = (n: string) => hardFilterFav(n) && visFilter(n)

  // BC favoritter splittet på STD-flag
  const bcStdLines     = bcStandardLines.filter(l => l.standardFavorite)
  const bcRegularLines = bcStandardLines.filter(l => !l.standardFavorite)
  const bcStdNos       = new Set(bcStdLines.map(l => l.itemNo))
  const bcRegularNos   = new Set(bcRegularLines.map(l => l.itemNo))
  const dbFavNos       = new Set(dbFavRows.map(f => f.bcItemNumber))

  // STD: vises uanset rangliste/pris (kun blokerede + X udelukkes)
  const stdFavNos = Array.from(bcStdNos).filter(hardFilterFav)
  // Almindelig favorit: kun varer på rangliste + med pris
  const customerFavSrc = bcRegularNos.size > 0 || bcStdNos.size > 0 ? bcRegularNos : dbFavNos
  const customerFavNos = Array.from(customerFavSrc)
    .filter(n => !bcStdNos.has(n) && regularFavFilter(n))

  // Venmark anbefaler — fra Item.SaelgforH
  const venmarkNosAll = Array.from(itemCutoffs.entries())
    .filter(([, v]) => v.saelgForH)
    .map(([itemNo]) => itemNo)
    .filter(n => !blockedSet.has(n) && !n.toUpperCase().startsWith('X') && visFilter(n))

  const allFavNos = [...stdFavNos, ...customerFavNos]
  const allNumbers = Array.from(new Set([...allFavNos, ...venmarkNosAll]))
    .filter(n => !existingNos.has(n))

  // ── Hent varekortdetaljer + attributter + enheder fra BC parallelt (samme som bestil) ─────
  const bcItems = await getItemsByNumbers(allNumbers)
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
        code: item.baseUnitOfMeasureCode,
        displayName: item.baseUnitOfMeasureCode,
        qtyPerUnitOfMeasure: 1,
        baseUnitOfMeasure: true,
      })
      for (const u of bcUoms) uomByCode.set(u.code, u)
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

  // STD-sektion (alle items, uanset pris)
  const stdFavorites = stdFavNos
    .filter(n => !existingNos.has(n))
    .map(n => itemMap.get(n))
    .filter((i): i is NonNullable<ReturnType<typeof itemMap.get>> => i != null)

  // Kundens egne favoritter — filtrér varer uden pris bort
  const stdNoSet = new Set(stdFavNos)
  const favorites = customerFavNos
    .filter(n => !existingNos.has(n) && !stdNoSet.has(n))
    .map(n => itemMap.get(n))
    .filter((i): i is NonNullable<ReturnType<typeof itemMap.get>> =>
      i != null && (i.unitPrice ?? 0) > 0)

  // Venmark anbefaler — udeluk dem der allerede er STD eller favorit
  const customerFavSet = new Set(customerFavNos)
  const venmarkItems = venmarkNosAll
    .filter(n => !existingNos.has(n) && !stdNoSet.has(n) && !customerFavSet.has(n))
    .map(n => itemMap.get(n))
    .filter((i): i is NonNullable<ReturnType<typeof itemMap.get>> => i != null)
    .map(item => ({ item, note: '' }))

  // Trappepriser til klient (samme som bestil)
  const priceTiers = portalPrices.map((p) => ({
    itemNo:          p.itemNo,
    minimumQuantity: p.minimumQuantity,
    unitPrice:       p.unitPrice,
    unitOfMeasure:   p.unitOfMeasure,
    startingDate:    p.startingDate,
    endingDate:      p.endingDate,
  }))

  const deliveryLabel = new Date(order.deliveryDate).toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'short',
  })

  return (
    <AddLinesClient
      orderId={order.id}
      bcOrderNumber={order.bcOrderNumber ?? undefined}
      deliveryLabel={deliveryLabel}
      deadline={order.deadline.toISOString()}
      stdFavorites={stdFavorites as any}
      favorites={favorites as any}
      venmarkItems={venmarkItems as any}
      priceTiers={priceTiers}
      initialFavNos={allFavNos}
      itemAvailabilities={Object.fromEntries(itemAvailabilities)}
    />
  )
}
