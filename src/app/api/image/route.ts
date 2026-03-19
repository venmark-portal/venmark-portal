import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Billed-proxy: henter billeder fra BC API med Bearer token
 * Brug: /api/image?url=<encoded BC image URL>
 */
export async function GET(req: NextRequest) {
  const imageUrl = req.nextUrl.searchParams.get('url')
  if (!imageUrl) {
    return new NextResponse('Mangler url parameter', { status: 400 })
  }

  // Valider at URL'en peger på BC API
  if (!imageUrl.startsWith('https://api.businesscentral.dynamics.com/')) {
    return new NextResponse('Ugyldig billed-URL', { status: 403 })
  }

  // Hent token
  const tenantId     = process.env.BC_TENANT_ID!
  const clientId     = process.env.BC_CLIENT_ID!
  const clientSecret = process.env.BC_CLIENT_SECRET!

  const tokenRes = await fetch(
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

  if (!tokenRes.ok) {
    return new NextResponse('Token fejl', { status: 500 })
  }

  const { access_token } = await tokenRes.json()

  // Hent billedet fra BC
  const imgRes = await fetch(imageUrl, {
    headers: { Authorization: `Bearer ${access_token}` },
  })

  if (!imgRes.ok) {
    return new NextResponse('Billede ikke fundet', { status: 404 })
  }

  const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg'
  const buffer = await imgRes.arrayBuffer()

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
