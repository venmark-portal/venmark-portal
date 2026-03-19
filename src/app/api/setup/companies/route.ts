import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

async function getToken(tenantId: string, clientId: string, clientSecret: string) {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         'https://api.businesscentral.dynamics.com/.default',
      }),
    }
  )
  const text = await res.text()
  if (!res.ok) throw new Error(`Token fejl: ${text}`)
  return JSON.parse(text).access_token as string
}

export async function GET() {
  const tenantId     = process.env.BC_TENANT_ID!
  const clientId     = process.env.BC_CLIENT_ID!
  const clientSecret = process.env.BC_CLIENT_SECRET!

  let token: string
  try {
    token = await getToken(tenantId, clientId, clientSecret)
  } catch (e) {
    return NextResponse.json({ fejl: String(e) }, { status: 500 })
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }

  // Prøv forskellige miljønavne
  const miljoer = ['Sandbox-Test', 'sandbox-test', 'Production', 'production', 'Sandbox', 'sandbox']
  const resultater: Record<string, unknown> = {}

  for (const env of miljoer) {
    const url = `https://api.businesscentral.dynamics.com/v2.0/${tenantId}/${env}/api/v2.0/companies`
    const res = await fetch(url, { headers })
    const text = await res.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = text }
    resultater[env] = { status: res.status, svar: parsed }

    // Stop hvis vi finder virksomheder
    if (res.ok && parsed?.value?.length > 0) {
      return NextResponse.json({
        succes: true,
        miljø_der_virker: env,
        virksomheder: parsed.value.map((c: {id: string; name: string}) => ({
          id: c.id,
          name: c.name,
        })),
      })
    }
  }

  return NextResponse.json({
    succes: false,
    besked: 'Ingen virksomheder fundet i nogen miljøer',
    alle_forsøg: resultater,
  })
}
