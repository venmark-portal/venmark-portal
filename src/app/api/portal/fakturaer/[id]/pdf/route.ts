import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPostedInvoices } from '@/lib/businesscentral'

export const runtime = 'nodejs'

/**
 * GET /api/portal/fakturaer/[id]/pdf
 * [id] = portal API invoice id (systemId fra Sales Invoice Header)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  }

  const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''
  const invoiceId  = params.id

  // Verificér at fakturaen tilhører kunden
  const threeYearsAgo = new Date()
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3)
  const invoices = await getPostedInvoices(customerNo, threeYearsAgo.toISOString().split('T')[0])
  const invoice  = invoices.find(inv => inv.id === invoiceId)

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

    // Brug portal API's id direkte — det er systemId fra Sales Invoice Header
    // som matcher v2.0 pdfDocument endpoint
    const pdfUrl = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies(${company})/salesInvoices(${invoiceId})/pdfDocument/$value`
    console.log('[PDF] henter:', pdfUrl)

    const pdfRes = await fetch(pdfUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
    })

    if (pdfRes.status === 404) {
      // Fakturaen er ikke i BC's standard API (typisk ældre fakturaer i sandbox)
      // Redirect til HTML-print som fallback
      console.log('[PDF] ikke i BC standard API, redirecter til HTML-print')
      return NextResponse.redirect(
        new URL(`/portal/fakturaer/${invoice.number}/print?print=1`, _req.url)
      )
    }

    if (!pdfRes.ok) {
      const errText = await pdfRes.text()
      console.error('[PDF] BC fejl:', pdfRes.status, errText)
      return NextResponse.json({ error: `BC fejl: ${pdfRes.status}` }, { status: 502 })
    }

    const pdfBuffer = await pdfRes.arrayBuffer()
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="Faktura-${invoice.number}.pdf"`,
        'Content-Length':      String(pdfBuffer.byteLength),
      },
    })
  } catch (e: any) {
    console.error('[PDF] fejl:', e)
    return NextResponse.json({ error: 'Kunne ikke hente PDF' }, { status: 500 })
  }
}
