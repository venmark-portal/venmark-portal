import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getPortalPrices,
  getItemNumbersByCategory,
  getItemsByNumbers,
  getItemsAttributeValues,
  getItemsUoMs,
  getWebshopVisibleItemNos,
} from '@/lib/businesscentral'
import type { BCPortalPrice, BCItemUoM } from '@/lib/businesscentral'
import { prisma } from '@/lib/prisma'

function startPrice(itemNo: string, prices: BCPortalPrice[], today: string): number | null {
  const applicable = prices.filter(
    p => p.itemNo === itemNo &&
      p.minimumQuantity <= 1 &&
      (!p.startingDate || p.startingDate <= today) &&
      (!p.endingDate   || p.endingDate.startsWith('0001') || p.endingDate   >= today),
  )
  if (!applicable.length) return null
  return Math.min(...applicable.map(p => p.unitPrice))
}

// GET /api/portal/category-items?category=FERSK
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const customerNo = (session?.user as any)?.bcCustomerNumber as string ?? ''
  const priceGrp   = (session?.user as any)?.bcPriceGroup     as string ?? ''
  const userId     = (session?.user as any)?.id               as string

  const category = req.nextUrl.searchParams.get('category') ?? ''
  if (!category) return NextResponse.json({ error: 'category mangler' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]

  // Hent priser + varenumre i kategori + blokerede + rangering parallelt
  const [portalPrices, categoryNos, blockedRows, webshopVisible] = await Promise.all([
    getPortalPrices(customerNo, priceGrp),
    getItemNumbersByCategory(category),
    prisma.blockedItem.findMany({ where: { customerId: userId } }),
    getWebshopVisibleItemNos().catch(() => null),
  ])

  const blockedSet  = new Set(blockedRows.map(b => b.bcItemNumber))
  const filteredNos = categoryNos.filter(no =>
    !blockedSet.has(no) && (webshopVisible === null || webshopVisible.has(no))
  )

  if (filteredNos.length === 0) return NextResponse.json({ items: [], priceTiers: [] })

  const bcItems = await getItemsByNumbers(filteredNos)

  if (bcItems.length === 0) return NextResponse.json({ items: [], priceTiers: [] })

  // Hent attributter + enheder
  const itemRefs = bcItems.map(i => ({ id: i.id, number: i.number }))
  const [attrMap, uomMap] = await Promise.all([
    getItemsAttributeValues(itemRefs),
    getItemsUoMs(itemRefs),
  ])

  const items = bcItems.map(item => {
    const attrs  = attrMap.get(item.number) ?? []
    const bcUoms = uomMap.get(item.number)  ?? []

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

    return {
      ...item,
      unitPrice:  startPrice(item.number, portalPrices, today) ?? item.unitPrice,
      attributes: attrs,
      uoms:       Array.from(uomByCode.values()),
      pictureId:  item.picture?.id ?? null,
    }
  })

  const itemNosSet = new Set(bcItems.map(i => i.number))
  const priceTiers = portalPrices
    .filter(p => itemNosSet.has(p.itemNo))
    .map(p => ({
      itemNo:          p.itemNo,
      minimumQuantity: p.minimumQuantity,
      unitPrice:       p.unitPrice,
      unitOfMeasure:   p.unitOfMeasure,
      startingDate:    p.startingDate,
      endingDate:      p.endingDate,
    }))

  return NextResponse.json({ items, priceTiers })
}
