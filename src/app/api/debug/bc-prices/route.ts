import { NextResponse } from 'next/server'
import { getItems, getPortalPrices } from '@/lib/businesscentral'

export const dynamic = 'force-dynamic'

export async function GET() {
  const tenant  = process.env.BC_TENANT_ID
  const env     = process.env.BC_ENVIRONMENT_NAME ?? 'sandbox-test'
  const company = process.env.BC_COMPANY_ID

  // Test 1: brug PORTAL'ENS eget getItems() med cached token
  let portalItems: any = null
  let portalItemsError: any = null
  try {
    const res = await getItems({ search: 'rødspætte', top: 2 })
    portalItems = res.value?.map((i: any) => i.number + ' ' + i.displayName)
  } catch (e: any) {
    portalItemsError = e.message
  }

  // Test 2: brug portal's getPortalPrices() med cached token
  let portalPrices: any = null
  let portalPricesError: any = null
  try {
    const res = await getPortalPrices('98945965', '9999FHSJÆ')
    // Vis ALLE prisrækker for vare 10400 — så vi kan se om trappepriser er der
    const item10400 = res.filter(p => p.itemNo === '10400')
    portalPrices = {
      total_count: res.length,
      item_10400_all_rows: item10400,
      item_10400_count: item10400.length,
      has_tiers_10400: item10400.length > 1,
      favorites_sample: res.filter(p => p.portalFavorite).slice(0, 5).map(p => ({
        item: p.itemNo, price: p.unitPrice, minQty: p.minimumQuantity, uom: p.unitOfMeasure,
      })),
    }
  } catch (e: any) {
    portalPricesError = e.message
  }

  // Test 3: frisk token (direkte Azure AD kald)
  let freshTokenStatus = 0
  let freshTokenOk = false
  let bcTestStatus = 0
  let bcCompanies: any = null
  let bcErrorBody: any = null
  try {
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'client_credentials',
          client_id:     process.env.BC_CLIENT_ID!,
          client_secret: process.env.BC_CLIENT_SECRET!,
          scope:         'https://api.businesscentral.dynamics.com/.default',
        }),
      }
    )
    freshTokenStatus = tokenRes.status
    freshTokenOk = tokenRes.ok
    if (tokenRes.ok) {
      const { access_token } = await tokenRes.json()
      // Test A: companies-liste (ingen company ID krævet)
      const bcRes = await fetch(
        `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies`,
        { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } }
      )
      bcTestStatus = bcRes.status
      if (bcRes.ok) {
        const bcJson = await bcRes.json()
        bcCompanies = bcJson.value?.map((c: any) => ({ id: c.id, name: c.name }))
      } else {
        bcErrorBody = await bcRes.text()
      }
    }
  } catch (e: any) {
    freshTokenStatus = -1
  }

  // Test 4: direkte kald til custom extension API
  let extStatus = 0
  let extBody: any = null
  try {
    const tokenRes2 = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: process.env.BC_CLIENT_ID!,
          client_secret: process.env.BC_CLIENT_SECRET!,
          scope: 'https://api.businesscentral.dynamics.com/.default',
        }),
      }
    )
    if (tokenRes2.ok) {
      const { access_token } = await tokenRes2.json()
      // Test uden filter (alle) + med simpelt filter for debitor 98945965
      const extRes = await fetch(
        `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})/portalPrices?$filter=${encodeURIComponent("sourceNo eq '98945965'")}&$top=5`,
        { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } }
      )
      extStatus = extRes.status
      extBody = await extRes.text()
    }
  } catch (e: any) {
    extBody = e.message
  }

  // Test 4b: direkte råt opslag på item 10400 priser — alle sources
  let item10400raw: any = null
  try {
    const tokenRes4 = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: process.env.BC_CLIENT_ID!,
          client_secret: process.env.BC_CLIENT_SECRET!,
          scope: 'https://api.businesscentral.dynamics.com/.default',
        }),
      }
    )
    if (tokenRes4.ok) {
      const { access_token } = await tokenRes4.json()
      const base = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`
      // Hent ALLE prisrækker for item 10400 uanset kunde/prisgruppe
      const r = await fetch(
        `${base}/portalPrices?$filter=${encodeURIComponent("itemNo eq '10400'")}&$top=50`,
        { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } }
      )
      item10400raw = {
        status: r.status,
        rows: r.ok ? (await r.json()).value : await r.text(),
      }
    }
  } catch (e: any) {
    item10400raw = { error: e.message }
  }

  // Test 5: bogførte fakturaer — prøv 3 varianter
  let invTests: any = {}
  try {
    const tokenRes3 = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: process.env.BC_CLIENT_ID!,
          client_secret: process.env.BC_CLIENT_SECRET!,
          scope: 'https://api.businesscentral.dynamics.com/.default',
        }),
      }
    )
    if (tokenRes3.ok) {
      const { access_token } = await tokenRes3.json()
      const h = { Authorization: `Bearer ${access_token}`, Accept: 'application/json' }
      const base = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies(${company})`

      // Variant A: standard v2.0 uden filter
      const rA = await fetch(`${base}/postedSalesInvoices?$top=1`, { headers: h })
      invTests.A_noFilter = { status: rA.status, body: rA.ok ? (await rA.json()).value?.length + ' records' : await rA.text() }

      // Variant B: salesInvoices — vis statuses og data for kunde 98945965
      const rB = await fetch(`${base}/salesInvoices?$filter=${encodeURIComponent("customerNumber eq '98945965'")}&$top=3&$select=id,number,invoiceDate,status,customerNumber,totalAmountIncludingTax`, { headers: h })
      invTests.B_salesInvoices = { status: rB.status, body: rB.ok ? await rB.json() : await rB.text() }

      // Variant C: andet selskab "Venmark Fisk" (6266e366-27df-f011-8542-7c1e521296a5)
      const companyB = '6266e366-27df-f011-8542-7c1e521296a5'
      const rC = await fetch(`https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies(${companyB})/postedSalesInvoices?$top=1`, { headers: h })
      invTests.C_otherCompany = { status: rC.status, body: rC.ok ? (await rC.json()).value?.length + ' records' : await rC.text() }
    }
  } catch (e: any) {
    invTests.error = (e as any).message
  }

  return NextResponse.json({
    config: { tenant, env, company },
    portal_getItems:        { items: portalItems,  error: portalItemsError },
    portal_getPortalPrices: { data: portalPrices,  error: portalPricesError },
    item_10400_raw_all_sources: item10400raw,
    fresh_token:            { tokenStatus: freshTokenStatus, tokenOk: freshTokenOk, bcCompaniesStatus: bcTestStatus, bcCompanies, bcErrorBody },
    custom_api_direct:      { status: extStatus, body: extBody },
    invoices_test:          invTests,
  })
}
