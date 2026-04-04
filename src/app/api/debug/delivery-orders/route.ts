import { NextRequest, NextResponse } from 'next/server'
import { getAccessToken } from '@/lib/businesscentral'

export const runtime = 'nodejs'

// Debug: GET /api/debug/delivery-orders?date=2026-01-05
// Viser rå svar fra BC deliveryOrders endpoint — ingen filter som default,
// eller med ?date=YYYY-MM-DD for at filtrere på postingDate
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  const field = req.nextUrl.searchParams.get('field') ?? 'postingDate' // eller requestedDeliveryDate

  const token   = await getAccessToken()
  const tenant  = process.env.BC_TENANT_ID!
  const env     = process.env.BC_ENVIRONMENT_NAME ?? 'production'
  const company = process.env.BC_COMPANY_ID!
  const base    = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

  // Byg URL — med eller uden filter
  let url = `${base}/deliveryOrders?$top=20`
  if (date) {
    url += `&$filter=${encodeURIComponent(`${field} eq ${date}`)}`
  }

  const res = await fetch(url, { headers, cache: 'no-store' })
  const rawText = await res.text()

  let parsed: any
  try { parsed = JSON.parse(rawText) } catch { parsed = rawText }

  const summary = Array.isArray(parsed?.value)
    ? parsed.value.map((o: any) => ({
        number:                o.number,
        status:                o.status,
        postingDate:           o.postingDate,
        requestedDeliveryDate: o.requestedDeliveryDate,
        shipmentMethodCode:    o.shipmentMethodCode,
        customerName:          o.customerName,
      }))
    : null

  return NextResponse.json({
    url,
    httpStatus: res.status,
    totalCount: parsed?.value?.length ?? 0,
    odataCount: parsed?.['@odata.count'] ?? null,
    hasNextLink: !!parsed?.['@odata.nextLink'],
    summary,
    rawError: res.ok ? null : rawText,
  }, { status: 200 })
}
