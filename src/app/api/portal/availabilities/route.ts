import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getActiveCustomerNo } from '@/lib/activeCustomer'
import { getCustomerLocationCode, getItemAvailabilities } from '@/lib/businesscentral'

// On-demand disponibilitet for en liste varenumre (kategori-browsing + søgning).
// Bestillingssiden henter kun favoritternes disponibilitet ved load; når kunden browser
// en kategori eller søger, henter klienten de nye varers disponibilitet her og fletter ind.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ availabilities: {} }, { status: 401 })
  try {
    const body = await req.json()
    const itemNos: string[] = Array.isArray(body?.itemNos) ? body.itemNos.filter((n: any) => typeof n === 'string' && n) : []
    if (!itemNos.length) return NextResponse.json({ availabilities: {} })

    const customerNo = getActiveCustomerNo(session)
    const loc = await getCustomerLocationCode(customerNo).catch(() => '')
    const map = await getItemAvailabilities(loc, itemNos).catch(() => new Map())

    const availabilities: Record<string, unknown> = {}
    map.forEach((v, k) => { availabilities[k] = v })
    return NextResponse.json({ availabilities })
  } catch {
    return NextResponse.json({ availabilities: {} }, { status: 500 })
  }
}
