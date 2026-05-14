import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPortalPrices } from '@/lib/businesscentral'

export const dynamic = 'force-dynamic'

// Samme logik som buildDisplayTiers i OrderList.tsx — kør den her server-side for at debugge
function simulateBuildDisplayTiers(
  tiers: { itemNo: string; minimumQuantity: number; unitPrice: number; unitOfMeasure: string; startingDate: string | null; endingDate: string | null }[],
  itemNo: string,
  baseUomCode: string,
  today: string,
) {
  const direct = tiers.filter(tier =>
    tier.itemNo === itemNo &&
    (!tier.unitOfMeasure || tier.unitOfMeasure === baseUomCode) &&
    (!tier.startingDate || tier.startingDate <= today) &&
    (!tier.endingDate   || tier.endingDate   >= today),
  )
  if (!direct.length) return { direct: [], result: [] }

  const breakpoints = Array.from(new Set(direct.map(v =>
    Math.max(1, Math.ceil(v.minimumQuantity)),
  ))).sort((a, b) => a - b)

  const result: { minimumQuantity: number; unitPrice: number }[] = []
  let lastBestPrice = Infinity
  for (const minQty of breakpoints) {
    const bestPrice = Math.min(...direct.filter(v => v.minimumQuantity <= minQty).map(v => v.unitPrice))
    if (bestPrice < lastBestPrice) {
      result.push({ minimumQuantity: minQty, unitPrice: bestPrice })
      lastBestPrice = bestPrice
    }
  }
  return { direct, result }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const customerNo = (session?.user as any)?.bcCustomerNumber as string ?? ''
  const priceGrp   = (session?.user as any)?.bcPriceGroup     as string ?? ''

  const today = new Date().toISOString().split('T')[0]

  let prices: any = null
  let error: any = null
  try {
    const res = await getPortalPrices(customerNo, priceGrp)

    const checkItems = ['23995', '70011', '10400']
    const itemAnalysis: Record<string, any> = {}
    for (const no of checkItems) {
      const rows = res.filter(p => p.itemNo === no)
      const sim = simulateBuildDisplayTiers(rows, no, 'KG', today)
      itemAnalysis[no] = {
        total_rows: rows.length,
        by_source: rows.reduce((acc, p) => {
          const k = `${p.sourceType}/${p.sourceNo}`
          if (!acc[k]) acc[k] = []
          acc[k].push({ minQty: p.minimumQuantity, price: p.unitPrice, uom: p.unitOfMeasure })
          return acc
        }, {} as Record<string, any[]>),
        buildDisplayTiers_direct_count: sim.direct.length,
        buildDisplayTiers_result: sim.result,
        has_real_tiers: sim.result.length > 1,
      }
    }

    const sourceTypeCounts: Record<string, number> = {}
    for (const p of res) {
      sourceTypeCounts[p.sourceType] = (sourceTypeCounts[p.sourceType] ?? 0) + 1
    }

    prices = {
      session_customerNo: customerNo,
      session_priceGroup: priceGrp,
      total_price_rows: res.length,
      source_type_distribution: sourceTypeCounts,
      item_analysis: itemAnalysis,
    }
  } catch (e: any) {
    error = e.message
  }

  return NextResponse.json({ prices, error })
}
