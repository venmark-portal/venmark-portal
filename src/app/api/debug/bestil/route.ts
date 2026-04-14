import { NextResponse } from 'next/server'
import { getAccessToken } from '@/lib/businesscentral'

export const dynamic = 'force-dynamic'

// Debug: vis hvad bestillingssiden faktisk henter fra BC
// Brug: /api/debug/bestil?customerNo=XXXXX&priceGroup=YYYY
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const customerNo = searchParams.get('customerNo') ?? '98945965'
  const priceGroup = searchParams.get('priceGroup') ?? '9999FHSJÆ'

  const token   = await getAccessToken()
  const tenant  = process.env.BC_TENANT_ID!
  const env     = process.env.BC_ENVIRONMENT_NAME!
  const company = process.env.BC_COMPANY_ID!
  const base    = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

  async function rawFetch(url: string) {
    const res = await fetch(url, { headers, cache: 'no-store' })
    const text = await res.text()
    let parsed: any = null
    try { parsed = JSON.parse(text) } catch {}
    return {
      status: res.status,
      count: parsed?.value?.length ?? null,
      hasNextLink: !!parsed?.['@odata.nextLink'],
      nextLink: parsed?.['@odata.nextLink'] ?? null,
      sample: parsed?.value?.slice(0, 3) ?? null,
      error: res.ok ? null : text,
    }
  }

  // Test 1: customerFavorites — første side
  const favUrl = `${base}/customerFavorites?$filter=${encodeURIComponent(`customerNo eq '${customerNo}'`)}&$top=500`
  const favResult = await rawFetch(favUrl)

  // Test 2: portalPrices — kunde-specifikke
  const pricesCustUrl = `${base}/portalPrices?$filter=${encodeURIComponent(`sourceType eq 'Customer' and sourceNo eq '${customerNo}'`)}&$top=1000`
  const pricesCust = await rawFetch(pricesCustUrl)

  // Test 3: portalPrices — All Customers (begge enum-varianter)
  const pricesAll1Url = `${base}/portalPrices?$filter=${encodeURIComponent(`sourceType eq 'All Customers'`)}&$top=1000`
  const pricesAll2Url = `${base}/portalPrices?$filter=${encodeURIComponent(`sourceType eq 'All_x0020_Customers'`)}&$top=1000`
  const [pricesAll1, pricesAll2] = await Promise.all([rawFetch(pricesAll1Url), rawFetch(pricesAll2Url)])

  // Test 4: itemCutoffs — første side
  const cutoffUrl = `${base}/itemCutoffs?$select=itemNo,portalCutoffWeekday,portalCutoffHour,portalSaelgForH,itemCategoryCode&$top=1000`
  const cutoffResult = await rawFetch(cutoffUrl)

  // Test 5: Tæl saelgForH=true i første side
  const saelgForHCount = cutoffResult.sample
    ? '(kun sample)'
    : null

  return NextResponse.json({
    params: { customerNo, priceGroup },
    customerFavorites: {
      url: favUrl,
      ...favResult,
    },
    portalPrices_customer: {
      url: pricesCustUrl,
      ...pricesCust,
      favoritesInSample: pricesCust.sample?.filter((p: any) => p.portalFavorite)?.length ?? 0,
    },
    portalPrices_allCustomers_v1: {
      url: pricesAll1Url,
      ...pricesAll1,
    },
    portalPrices_allCustomers_v2: {
      url: pricesAll2Url,
      ...pricesAll2,
    },
    itemCutoffs: {
      url: cutoffUrl,
      ...cutoffResult,
      saelgForHInSample: cutoffResult.sample?.filter((i: any) => i.portalSaelgForH === true)?.length ?? 0,
    },
  })
}
