import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getPortalPrices,
  getItemsByNumbers,
  getItemsAttributeValues,
  getItemsUoMs,
  getItemCutoffs,
} from '@/lib/businesscentral'
import type { BCPortalPrice, BCItemUoM } from '@/lib/businesscentral'
import { prisma } from '@/lib/prisma'

function startPrice(itemNo: string, prices: BCPortalPrice[], today: string): number | null {
  const tiers = prices
    .filter(
      p => p.itemNo === itemNo &&
        p.minimumQuantity <= 1 &&
        (!p.startingDate || p.startingDate <= today) &&
        (!p.endingDate   || p.endingDate   >= today),
    )
    .sort((a, b) => b.minimumQuantity - a.minimumQuantity)
  return tiers[0]?.unitPrice ?? null
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

  // Hent priser + cutoffs + blokerede parallelt
  const [portalPrices, itemCutoffs, blockedRows] = await Promise.all([
    getPortalPrices(customerNo, priceGrp),
    getItemCutoffs(),
    prisma.blockedItem.findMany({ where: { customerId: userId } }),
  ])

  const blockedSet = new Set(blockedRows.map(b => b.bcItemNumber))

  // Find varenumre i den valgte kategori med pris for denne kunde
  const pricedNos = new Set(portalPrices.map(p => p.itemNo))
  const categoryNos = Array.from(itemCutoffs.entries())
    .filter(([itemNo, data]) =>
      data.itemCategoryCode === category &&
      pricedNos.has(itemNo) &&
      !blockedSet.has(itemNo)
    )
    .map(([itemNo]) => itemNo)

  if (categoryNos.length === 0) return NextResponse.json({ items: [], priceTiers: [] })

  // Hent varedetaljer + attributter + enheder
  const bcItems = await getItemsByNumbers(categoryNos)
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

  const priceTiers = portalPrices
    .filter(p => categoryNos.includes(p.itemNo))
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
