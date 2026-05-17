import { NextResponse } from 'next/server'
import { getPortalPrices } from '@/lib/businesscentral'

export const dynamic = 'force-dynamic'

const TOP_LIMIT   = 20000
const WARN_AT     = Math.floor(TOP_LIMIT * 0.9)   // 4500
const PRICE_GROUP = process.env.HEALTH_CHECK_PRICE_GROUP ?? '9999FHSJÆ'
const CUSTOMER_NO = process.env.HEALTH_CHECK_CUSTOMER_NO ?? ''

export async function GET(req: Request) {
  // Simpel API-nøgle så endepunktet ikke er åbent for alle
  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')
  if (key !== process.env.HEALTH_CHECK_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const prices = await getPortalPrices(CUSTOMER_NO, PRICE_GROUP)
    const total   = prices.length
    const status  = total >= TOP_LIMIT ? 'critical' : total >= WARN_AT ? 'warning' : 'ok'

    return NextResponse.json({
      status,
      total_price_rows: total,
      top_limit:        TOP_LIMIT,
      warn_at:          WARN_AT,
      message: status === 'ok'
        ? `OK — ${total} rækker (grænse ${TOP_LIMIT})`
        : status === 'warning'
          ? `ADVARSEL — ${total} rækker nærmer sig grænsen på ${TOP_LIMIT}`
          : `KRITISK — ${total} rækker rammer grænsen på ${TOP_LIMIT}, priser kan mangle!`,
    }, { status: status === 'ok' ? 200 : status === 'warning' ? 200 : 500 })
  } catch (e: any) {
    return NextResponse.json({ status: 'error', message: e.message }, { status: 500 })
  }
}
