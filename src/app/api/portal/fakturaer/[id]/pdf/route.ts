import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPostedInvoices } from '@/lib/businesscentral'

export const runtime = 'nodejs'

/**
 * GET /api/portal/fakturaer/[id]/pdf
 * Henter PDF for en bogført faktura fra BC.
 * [id] = fakturanummer (fx 227516) — vi slår standard-GUID op via number-filter
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  }

  const customerNo    = (session.user as any)?.bcCustomerNumber as string ?? ''
  const invoiceNumber = params.id

  // Verificér at fakturaen tilhører kunden
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 3)
  const invoices = await getPostedInvoices(customerNo, oneYearAgo.toISOString().split('T')[0])
  const invoice  = invoices.find(inv => inv.number === invoiceNumber)

  if (!invoice) {
    return NextResponse.json({ error: 'Faktura ikke fundet' }, { status: 404 })
  }

  try {
    const tenant  = process.env.BC_TENANT_ID
    const env     = process.env.BC_ENVIRONMENT_NAME
    const company = process.env.BC_COMPANY_ID

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
      },
    )
    const { access_token: token } = await tokenRes.json()

    // Slå standard-GUID op via fakturanummer i v2.0 API (bogførte fakturaer)
    const lookupUrl = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies(${company})/postedSalesInvoices?$filter=number eq '${invoiceNumber}'&$select=id,number`
    const lookupRes = await fetch(lookupUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const lookupData = await lookupRes.json()
    console.log('[PDF] lookup status:', lookupRes.status, 'data:', JSON.stringify(lookupData).slice(0, 300))
    const stdInvoice = lookupData?.value?.[0]

    if (!stdInvoice?.id) {
      console.error('[PDF] Faktura-GUID ikke fundet for nummer', invoiceNumber)
      return NextResponse.json({ error: 'Faktura ikke fundet i BC' }, { status: 404 })
    }
    console.log('[PDF] bruger GUID:', stdInvoice.id)

    // Hent PDF via standard API — bruger rapport fra Rapportvalg - Salg (Faktura)
    const pdfUrl = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies(${company})/postedSalesInvoices(${stdInvoice.id})/pdfDocument/$value`
    const pdfRes = await fetch(pdfUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
    })

    if (!pdfRes.ok) {
      const errText = await pdfRes.text()
      console.error('BC PDF fejl:', pdfRes.status, errText)
      return NextResponse.json({ error: `BC returnerede fejl: ${pdfRes.status}` }, { status: 502 })
    }

    const pdfBuffer = await pdfRes.arrayBuffer()

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="Faktura-${invoiceNumber}.pdf"`,
        'Content-Length':      String(pdfBuffer.byteLength),
      },
    })
  } catch (e: any) {
    console.error('PDF-fejl:', e)
    return NextResponse.json({ error: 'Kunne ikke hente PDF' }, { status: 500 })
  }
}
