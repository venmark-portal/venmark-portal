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
  const token   = await getToken()
  const tenant  = process.env.BC_TENANT_ID
  const env     = process.env.BC_ENVIRONMENT_NAME
  const company = process.env.BC_COMPANY_ID
  const base    = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

  let url: string
  if (what === 'itemCutoffs') {
    url = `${base}/itemCutoffs?$top=10`
  } else if (what === 'customerFavorites') {
    const f = encodeURIComponent(`customerNo eq '${customerNo}'`)
    url = `${base}/customerFavorites?$filter=${f}&$top=10`
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
