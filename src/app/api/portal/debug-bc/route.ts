import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// Midlertidig debug-route — slet efter fejlsøgning
// GET /api/portal/debug-bc?what=itemCutoffs|customerFavorites|portalPrices

async function getToken() {
  const tenant  = process.env.BC_TENANT_ID
  const clientId     = process.env.BC_CLIENT_ID
  const clientSecret = process.env.BC_CLIENT_SECRET
  const scope   = `https://api.businesscentral.dynamics.com/.default`

  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId!,
        client_secret: clientSecret!,
        scope,
      }),
    }
  )
  const d = await res.json()
  return d.access_token as string
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const what = searchParams.get('what') ?? 'itemCutoffs'

  const customerNo = (session?.user as any)?.bcCustomerNumber as string ?? ''
  const priceGroup = (session?.user as any)?.bcPriceGroup     as string ?? ''
  const token   = await getToken()
  const tenant  = process.env.BC_TENANT_ID
  const env     = process.env.BC_ENVIRONMENT_NAME
  const company = process.env.BC_COMPANY_ID
  const base    = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`
  const baseV2  = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies(${company})`
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

  if (what === 'portalPrices') {
    // Vis hvad hver filtervariant returnerer — til diagnose af prisgruppe-problem
    async function tryFetch(label: string, url: string) {
      const r = await fetch(url, { headers, cache: 'no-store' } as any)
      const t = await r.text()
      let v: any
      try { v = JSON.parse(t) } catch { v = t }
      return { label, status: r.status, count: v?.value?.length ?? 0, sample: v?.value?.slice(0, 3) ?? v }
    }
    const results = await Promise.all([
      tryFetch('customer', `${base}/portalPrices?$filter=${encodeURIComponent(`sourceType eq 'Customer' and sourceNo eq '${customerNo}'`)}&$top=10`),
      tryFetch('priceGroup_spaces', `${base}/portalPrices?$filter=${encodeURIComponent(`sourceType eq 'Customer Price Group' and sourceNo eq '${priceGroup}'`)}&$top=10`),
      tryFetch('priceGroup_underscores', `${base}/portalPrices?$filter=${encodeURIComponent(`sourceType eq 'Customer_Price_Group' and sourceNo eq '${priceGroup}'`)}&$top=10`),
      tryFetch('priceGroup_sourceNoOnly', `${base}/portalPrices?$filter=${encodeURIComponent(`sourceNo eq '${priceGroup}'`)}&$top=10`),
      tryFetch('allCustomers_spaces', `${base}/portalPrices?$filter=${encodeURIComponent(`sourceType eq 'All Customers'`)}&$top=10`),
      tryFetch('allCustomers_underscores', `${base}/portalPrices?$filter=${encodeURIComponent(`sourceType eq 'All_Customers'`)}&$top=10`),
      tryFetch('allCustomers_emptySourceNo', `${base}/portalPrices?$filter=${encodeURIComponent(`sourceNo eq ''`)}&$top=10`),
      tryFetch('item23995_noFilter', `${base}/portalPrices?$filter=${encodeURIComponent(`itemNo eq '23995'`)}&$top=20`),
    ])
    return NextResponse.json({ session: { customerNo, priceGroup }, results })
  }

  let url: string
  if (what === 'itemCutoffs') {
    url = `${base}/itemCutoffs?$top=10`
  } else if (what === 'customerFavorites') {
    const f = encodeURIComponent(`customerNo eq '${customerNo}'`)
    url = `${base}/customerFavorites?$filter=${f}&$top=10`
  } else if (what === 'itemCategories') {
    url = `${baseV2}/itemCategories?$top=100`
  } else if (what === 'items-sample') {
    url = `${baseV2}/items?$top=5&$select=number,displayName,itemCategoryCode&$filter=blocked eq false`
  } else if (what === 'uoms') {
    const itemNo = new URL(req.url).searchParams.get('itemNo') ?? '23994'
    // Hent item ID først
    const itemRes = await fetch(`${baseV2}/items?$filter=${encodeURIComponent(`number eq '${itemNo}'`)}&$select=id,number,baseUnitOfMeasureCode`, { headers })
    const itemData = await itemRes.json()
    const item = itemData.value?.[0]
    if (!item) return NextResponse.json({ error: 'item not found', itemNo })
    const uomRes = await fetch(`${baseV2}/items(${item.id})/itemUnitsOfMeasure`, { headers, cache: 'no-store' } as any)
    const uomData = await uomRes.json()
    return NextResponse.json({ itemNo, itemId: item.id, baseUom: item.baseUnitOfMeasureCode, uoms: uomData.value, status: uomRes.status })
  } else {
    return NextResponse.json({ error: 'unknown what param' }, { status: 400 })
  }

  const res = await fetch(url, { headers })
  const status = res.status
  const text = await res.text()
  let body: any
  try { body = JSON.parse(text) } catch { body = text }

  return NextResponse.json({ url, status, customerNo, body })
}
