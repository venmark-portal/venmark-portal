import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { getPortalPrices, getItemsByNumbers, getCustomerFavorites } from '@/lib/businesscentral'
import AddLinesClient from './AddLinesClient'

export const dynamic = 'force-dynamic'

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

  // Hent portalpriser, BC-favoritter (tabel 50157) og DB-favoritter parallelt
  const [portalPrices, bcFavRows, dbFavRows] = await Promise.all([
    getPortalPrices(customerNo, priceGrp),
    getCustomerFavorites(customerNo).catch(() => []),
    prisma.favorite.findMany({ where: { customerId } }),
  ])

  // BC tabel 50157 er eneste master — fallback til portal DB hvis BC er utilgængeligt
  const bcFavNos  = new Set(bcFavRows.map(f => f.itemNo))
  const dbFavNos  = new Set(dbFavRows.map(f => f.bcItemNumber))
  const allFavNos = [...(bcFavNos.size > 0 ? bcFavNos : dbFavNos)]

  // Hent varedetaljer fra BC for favoritter
  const favItems = allFavNos.length > 0 ? await getItemsByNumbers(allFavNos) : []

  // Byg liste med kundepris (baseret på portalpriser)
  const today = new Date().toISOString().split('T')[0]
  const favorites = favItems.map(item => {
    const tier = portalPrices
      .filter(p =>
        p.itemNo === item.number &&
        p.minimumQuantity <= 1 &&
        (!p.startingDate || p.startingDate <= today) &&
        (!p.endingDate   || p.endingDate   >= today),
      )
      .sort((a, b) => b.minimumQuantity - a.minimumQuantity)[0]
    return {
      number:                item.number,
      displayName:           item.displayName,
      baseUnitOfMeasureCode: item.baseUnitOfMeasureCode,
      unitPrice:             tier?.unitPrice ?? item.unitPrice,
    }
  })

  const deliveryLabel = new Date(order.deliveryDate).toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'short',
  })

  return (
    <AddLinesClient
      orderId={order.id}
      bcOrderNumber={order.bcOrderNumber ?? undefined}
      deliveryLabel={deliveryLabel}
      deadline={order.deadline.toISOString()}
      favorites={favorites}
    />
  )
}
