import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Diagnosticerer BC OAuth2-token og company-opsætning
// Brug: /api/debug/bc-auth
export async function GET() {
  const tenant  = process.env.BC_TENANT_ID ?? '(mangler)'
  const clientId = process.env.BC_CLIENT_ID ?? '(mangler)'
  const env     = process.env.BC_ENVIRONMENT_NAME ?? '(mangler)'
  const company = process.env.BC_COMPANY_ID ?? '(mangler)'
  const hasSecret = !!(process.env.BC_CLIENT_SECRET)

  // Trin 1: hent token fra Azure AD
  let tokenOk = false
  let tokenError: string | null = null
  let token = ''
  try {
    const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
    const body = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: process.env.BC_CLIENT_SECRET ?? '',
      scope:         'https://api.businesscentral.dynamics.com/.default',
    })
    const res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store' } as any)
    const data = await res.json()
    if (res.ok && data.access_token) {
      tokenOk = true
      token = data.access_token
    } else {
      tokenError = JSON.stringify(data)
    }
  } catch (e: any) {
    tokenError = e.message
  }

  // Trin 2: list companies (kræver ikke company-ID)
  let companiesResult: any = null
  let companiesUrlUsed = ''
  if (tokenOk) {
    try {
      companiesUrlUsed = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies`
      const res = await fetch(companiesUrlUsed, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      } as any)
      const text = await res.text()
      let parsed: any = null
      try { parsed = JSON.parse(text) } catch {}
      companiesResult = {
        urlUsed: companiesUrlUsed,
        status: res.status,
        companies: parsed?.value?.map((c: any) => ({ id: c.id, name: c.name })) ?? null,
        error: res.ok ? null : text,
      }
    } catch (e: any) {
      companiesResult = { error: e.message }
    }
  }

  // Trin 3: test konfigureret company-ID direkte
  let companyTest: any = null
  if (tokenOk) {
    try {
      const base = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies(${company})`
      const res = await fetch(base, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      } as any)
      const text = await res.text()
      let parsed: any = null
      try { parsed = JSON.parse(text) } catch {}
      companyTest = { status: res.status, name: parsed?.name ?? null, error: res.ok ? null : text }
    } catch (e: any) {
      companyTest = { error: e.message }
    }
  }

  // Trin 4: test custom portal API med konfigureret company
  let portalApiTest: any = null
  if (tokenOk) {
    try {
      const base = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`
      const url  = `${base}/itemCutoffs?$select=itemNo&$top=1`
      const res  = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      } as any)
      const text = await res.text()
      let parsed: any = null
      try { parsed = JSON.parse(text) } catch {}
      portalApiTest = { status: res.status, count: parsed?.value?.length ?? null, error: res.ok ? null : text }
    } catch (e: any) {
      portalApiTest = { error: e.message }
    }
  }

  const secretRaw = process.env.BC_CLIENT_SECRET ?? ''
  return NextResponse.json({
    config: { tenant, clientId, env, company, hasSecret,
      secretLength: secretRaw.length,
      secretFirst5: secretRaw.substring(0, 5),
      secretLast3: secretRaw.substring(secretRaw.length - 3),
      tokenFirst30: token.substring(0, 30),
      tokenLength: token.length,
    },
    step1_token: { ok: tokenOk, error: tokenError },
    step2_companies: companiesResult,
    step3_companyById: companyTest,
    step4_portalApi: portalApiTest,
  })
}
