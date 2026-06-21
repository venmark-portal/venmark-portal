import { NextRequest, NextResponse } from 'next/server'
import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'

export const runtime = 'nodejs'

/**
 * Offentlig (uden login) PDF-download af én bogført salgsfaktura.
 *
 * Linket kommer fra kontoudtogs-mailen i BC: <Portal URL>/faktura/<SystemId>.
 * `id` er fakturaens SystemId (en tilfældig GUID) — den fungerer som token:
 * ulæselig og kan ikke gættes/enumeres. Ingen anden kundedata eksponeres her,
 * kun selve PDF'en.
 *
 * PDF'en hentes fra BC's eksisterende API `postedInvoicePdfs(<SystemId>)`
 * (AL page 50175, base64 af fakturarapport 50040) med portalens service-credentials.
 */

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function errorPage(message: string, status: number): NextResponse {
  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Venmark Fisk — faktura</title>
<style>body{font-family:sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#222}
h1{font-size:20px}p{color:#555}</style></head>
<body><h1>${message}</h1>
<p>Kontakt bogholderiet på <a href="mailto:fisk@venmark.dk">fisk@venmark.dk</a> hvis du har brug for fakturaen.</p>
</body></html>`
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id
  if (!GUID_RE.test(id)) {
    return errorPage('Ugyldigt fakturalink', 404)
  }

  try {
    const token = await getAccessToken()
    const base  = bcPortalBaseUrl()

    const res = await fetch(`${base}/postedInvoicePdfs(${id})`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    })

    if (!res.ok) {
      // 404 fra BC = ukendt/slettet faktura; andet = uventet BC-fejl
      return errorPage('Faktura ikke fundet', res.status === 404 ? 404 : 502)
    }

    const data = await res.json()
    const b64: string = data?.pdfBase64 ?? ''
    const number: string = data?.number ?? id
    if (!b64) {
      return errorPage('Fakturaen kunne ikke hentes lige nu', 404)
    }

    const pdf = new Uint8Array(Buffer.from(b64, 'base64'))

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Faktura-${number}.pdf"`,
        // Aldrig cache i delte caches — linket er kundespecifikt
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (e: any) {
    console.error('[faktura/[id]] fejl:', e?.message ?? e)
    return errorPage('Der opstod en fejl', 500)
  }
}
