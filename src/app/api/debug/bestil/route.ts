import { NextResponse } from 'next/server'
import { getAccessToken, getPortalShipmentMethods, getCustomerShipmentMethodCode, getCustomerPortalShipmentMethods } from '@/lib/businesscentral'
import { getDeliveryDatesForMethod, parseCutoffTime } from '@/lib/dateUtils'

export const dynamic = 'force-dynamic'

// Debug: vis hvad bestillingssiden faktisk henter fra BC
// Brug: /api/debug/bestil?customerNo=XXXXX&priceGroup=YYYY
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const customerNo = searchParams.get('customerNo') ?? '98945965'
  const priceGroup = searchParams.get('priceGroup') ?? '9999FHSJÆ'

  const envCheck = {
    BC_TENANT_ID:       process.env.BC_TENANT_ID       ? '✓ sat' : '✗ MANGLER',
    BC_CLIENT_ID:       process.env.BC_CLIENT_ID        ? '✓ sat' : '✗ MANGLER',
    BC_CLIENT_SECRET:   process.env.BC_CLIENT_SECRET    ? `✓ sat (${process.env.BC_CLIENT_SECRET.length} tegn)` : '✗ MANGLER',
    BC_ENVIRONMENT_NAME:process.env.BC_ENVIRONMENT_NAME ?? '✗ MANGLER',
    BC_COMPANY_ID:      process.env.BC_COMPANY_ID       ? '✓ sat' : '✗ MANGLER',
  }

  let token: string
  let tokenError: string | null = null
  try {
    token = await getAccessToken()
  } catch (e: any) {
    token = ''
    tokenError = String(e)
  }

  const tenant  = process.env.BC_TENANT_ID!
  const env     = process.env.BC_ENVIRONMENT_NAME!
  const company = process.env.BC_COMPANY_ID!
  const base    = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`
  const baseV2  = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0`
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
      error: res.ok ? null : text.slice(0, 500),
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

  // Test 5: itemCutoffs MED filter på saelgForH (tester om BC tillader det)
  const cutoffFilteredUrl = `${base}/itemCutoffs?$filter=${encodeURIComponent('portalSaelgForH eq true')}&$select=itemNo,portalSaelgForH&$top=50`
  const cutoffFiltered = await rawFetch(cutoffFilteredUrl)

  // Test 7: rangeringPrisliste — findes feltet og kan det filtreres?
  const rangNoFilterUrl = `${base}/itemCutoffs?$select=itemNo,rangeringPrisliste&$top=5`
  const rangNoFilter = await rawFetch(rangNoFilterUrl)
  const rangFilterUrl = `${base}/itemCutoffs?$filter=${encodeURIComponent('rangeringPrisliste gt 0')}&$select=itemNo,rangeringPrisliste&$top=5`
  const rangFilter = await rawFetch(rangFilterUrl)

  // Test 6: itemCutoffs uden filter men kun de første 50 — tæl saelgForH
  const cutoffSample50Url = `${base}/itemCutoffs?$select=itemNo,portalSaelgForH&$top=50&$skip=0`
  const cutoffSample50 = await rawFetch(cutoffSample50Url)
  const saelgForHInFirst50 = cutoffSample50.sample?.filter((i: any) => i.portalSaelgForH === true)?.length ?? 0

  // ── Baseline: standard v2.0 API (companies + items) ─────────────────────────
  const v2CompaniesUrl = `${baseV2}/companies`
  const v2ItemsUrl     = `${baseV2}/companies(${company})/items?$top=1`
  const [v2Companies, v2Items] = await Promise.all([rawFetch(v2CompaniesUrl), rawFetch(v2ItemsUrl)])

  // ── Direkte test: portalShipmentMethods ──────────────────────────────────────
  const shipMethodsUrl = `${base}/portalShipmentMethods`
  const shipMethodsRaw = await rawFetch(shipMethodsUrl)

  // ── Token-diagnostik: decode JWT payload ────────────────────────────────────
  const tokenPreview = token.length > 40
    ? `${token.slice(0, 20)}...${token.slice(-20)}`
    : token
  let tokenPayload: any = null
  try {
    const parts = token.split('.')
    if (parts.length === 3) {
      const json = Buffer.from(parts[1], 'base64url').toString('utf-8')
      const p = JSON.parse(json)
      tokenPayload = {
        aud:   p.aud,
        iss:   p.iss,
        appid: p.appid,
        tid:   p.tid,
        exp:   p.exp ? new Date(p.exp * 1000).toISOString() : null,
        roles: p.roles ?? [],
      }
    }
  } catch {}
  // Vis BC_CLIENT_ID delvist for verifikation
  const clientIdPartial = process.env.BC_CLIENT_ID
    ? `${process.env.BC_CLIENT_ID.slice(0, 8)}...${process.env.BC_CLIENT_ID.slice(-4)}`
    : 'MANGLER'

  // Test webshopVisible direkte
  const { getWebshopVisibleItemNos } = await import('@/lib/businesscentral')
  const webshopVisible = await getWebshopVisibleItemNos().catch(() => null)

  // ── Leveringsmetoder for denne kunde ────────────────────────────────────────
  const [allMethods, custShipCode, custAllowedCodes] = await Promise.all([
    getPortalShipmentMethods().catch((e: any) => ({ error: String(e) })),
    getCustomerShipmentMethodCode(customerNo).catch(() => ''),
    getCustomerPortalShipmentMethods(customerNo).catch(() => []),
  ])
  const methods = Array.isArray(allMethods) ? allMethods : []
  const allowedMethods = (custAllowedCodes as string[]).length > 0
    ? methods.filter((m: any) => (custAllowedCodes as string[]).includes(m.code))
    : methods.filter((m: any) => m.code === custShipCode)
  const customerMethod = allowedMethods[0] ?? methods.find((m: any) => m.code === custShipCode)
  const deliveryDays = customerMethod
    ? getDeliveryDatesForMethod(customerMethod as any, [], new Date(), 10).map(d => d.toISOString().split('T')[0])
    : []

  return NextResponse.json({
    env: envCheck,
    tokenStatus: { ok: !!token, length: token.length, preview: tokenPreview, payload: tokenPayload, clientIdPartial, error: tokenError },
    baseline_v2_API: {
      companies: { url: v2CompaniesUrl, ...v2Companies },
      items:     { url: v2ItemsUrl,     ...v2Items },
    },
    portalShipmentMethods_direct: { url: shipMethodsUrl, ...shipMethodsRaw },
    shipmentMethods: {
      allMethodsRaw: Array.isArray(allMethods) ? allMethods : allMethods,
      custShipCode,
      custAllowedCodes,
      allowedMethods,
      customerMethod,
      parsedCutoff: customerMethod ? parseCutoffTime((customerMethod as any).cutoffTime) : null,
      first10DeliveryDays: deliveryDays,
      now: new Date().toISOString(),
    },
    webshopVisible: {
      isNull: webshopVisible === null,
      size: webshopVisible?.size ?? 'N/A',
      sample: webshopVisible ? Array.from(webshopVisible).slice(0, 10) : [],
    },
    params: { customerNo, priceGroup },
    customerFavorites: { url: favUrl, ...favResult },
    portalPrices_customer: {
      url: pricesCustUrl, ...pricesCust,
      favoritesInSample: pricesCust.sample?.filter((p: any) => p.portalFavorite)?.length ?? 0,
    },
    portalPrices_allCustomers_v1: { url: pricesAll1Url, ...pricesAll1 },
    portalPrices_allCustomers_v2: { url: pricesAll2Url, ...pricesAll2 },
    itemCutoffs_noFilter: {
      url: cutoffUrl, ...cutoffResult,
      saelgForHInSample: cutoffResult.sample?.filter((i: any) => i.portalSaelgForH === true)?.length ?? 0,
    },
    itemCutoffs_withFilter: {
      url: cutoffFilteredUrl, ...cutoffFiltered,
      filterWorks: cutoffFiltered.status === 200,
    },
    rangeringPrisliste_noFilter: { url: rangNoFilterUrl, ...rangNoFilter },
    rangeringPrisliste_withFilter: { url: rangFilterUrl, ...rangFilter, filterWorks: rangFilter.status === 200 },
    itemCutoffs_first50: {
      saelgForHCount: saelgForHInFirst50,
      sample: cutoffSample50.sample?.filter((i: any) => i.portalSaelgForH === true),
    },
  })
}
