import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAverageSalesPriceForItems } from '@/lib/businesscentral'

// On-demand "ca. X kr."-estimater (gennemsnit af seneste salg) for varer uden aftalt pris.
// Udskudt fra page-load fordi det er per-vare faktura-opslag (~2s). Klienten henter dem
// efter render og fletter dem ind, så listen vises straks.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ estimatedPrices: {} }, { status: 401 })
  try {
    const body = await req.json()
    const itemNos: string[] = Array.isArray(body?.itemNos) ? body.itemNos.filter((n: any) => typeof n === 'string' && n) : []
    if (!itemNos.length) return NextResponse.json({ estimatedPrices: {} })

    const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''
    if (!customerNo) return NextResponse.json({ estimatedPrices: {} })

    const map = await getAverageSalesPriceForItems(customerNo, itemNos).catch(() => new Map<string, number>())
    const estimatedPrices: Record<string, number> = {}
    map.forEach((v, k) => { estimatedPrices[k] = v })
    return NextResponse.json({ estimatedPrices })
  } catch {
    return NextResponse.json({ estimatedPrices: {} }, { status: 500 })
  }
}
