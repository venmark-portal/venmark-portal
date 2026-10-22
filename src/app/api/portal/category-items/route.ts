import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getPortalPrices,
  pickPriceBySource,
  getItemNumbersByCategory,
  getItemsByNumbers,
  getItemsAttributeValues,
  getItemsUoMs,
  getWebshopVisibleItemNos,
} from '@/lib/businesscentral'
import type { BCPortalPrice, BCItemUoM } from '@/lib/businesscentral'
import { prisma } from '@/lib/prisma'
import { getPortalLang, getT } from '@/lib/i18n/portal/server'
import { oversaetVarenavne } from '@/lib/i18n/portal/varenavne'
import { bestilApiDict } from '@/lib/i18n/portal/dict/bestil-api'

function startPrice(itemNo: string, prices: BCPortalPrice[], today: string): number | null {
  const applicable = prices.filter(
    p => p.itemNo === itemNo &&
      p.minimumQuantity <= 1 &&
      (!p.startingDate || p.startingDate <= today) &&
      (!p.endingDate   || p.endingDate.startsWith('0001') || p.endingDate   >= today),
  )
  // Kilde-prioritet (kunde > kæde > gruppe/alle) i stedet for rå laveste-pris, så kæde-
  // prisen OVERRIDER gruppen også når den er højere — spejler BC-runtime.
  return pickPriceBySource(applicable)
}

// GET /api/portal/category-items?category=FERSK
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const lang = await getPortalLang()
  const t = await getT(bestilApiDict, lang)
  if (!session) return NextResponse.json({ error: t('ikkeLoggetInd') }, { status: 401 })

  const customerNo = (session?.user as any)?.bcCustomerNumber  as string ?? ''
  const priceGrp   = (session?.user as any)?.bcPriceGroup      as string ?? ''
  const chainGrp   = (session?.user as any)?.bcChainPriceGroup as string ?? ''
  const userId     = (session?.user as any)?.id                as string

  // Én eller FLERE kategorier (kommasepareret) — "Alle varer"/hovedkategori henter i batches.
  // Loft på 10 pr. kald, så et kald ikke vokser sig ubegrænset stort.
  const categories = (req.nextUrl.searchParams.get('category') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean).slice(0, 10)
  if (categories.length === 0) return NextResponse.json({ error: t('categoryMangler') }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]

  // Hent priser + varenumre i kategori(er) + blokerede + rangering parallelt
  const [portalPrices, categoryLists, blockedRows, webshopVisible] = await Promise.all([
    getPortalPrices(customerNo, priceGrp, chainGrp),
    Promise.all(categories.map(c => getItemNumbersByCategory(c))),
    prisma.blockedItem.findMany({ where: { customerId: userId } }),
    getWebshopVisibleItemNos().catch(() => null),
  ])
  const categoryNos = Array.from(new Set(categoryLists.flat()))

  const blockedSet  = new Set(blockedRows.map(b => b.bcItemNumber))
  const filteredNos = categoryNos.filter(no =>
    !blockedSet.has(no) && (webshopVisible === null || webshopVisible.has(no))
  )

  if (filteredNos.length === 0) return NextResponse.json({ items: [], priceTiers: [] })

  // Varenavne på kundens sprog; det danske navn i navnDa (sendes tilbage ved bestilling/favorit).
  const bcItems = await oversaetVarenavne(
    (await getItemsByNumbers(filteredNos)).map(i => ({ ...i, navnDa: i.displayName })), lang,
  )

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
      sourcePriority:  p.sourcePriority,
    }))

  return NextResponse.json({ items, priceTiers })
}
