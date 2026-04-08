import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPostedInvoices } from '@/lib/businesscentral'

export const runtime = 'nodejs'

/**
 * GET /api/portal/fakturaer/[id]/pdf
 * [id] = portal API invoice id (systemId fra Sales Invoice Header)
 *
 * Strategi:
 * 1. Prøv direkte ID-opslag i standard v2.0 salesInvoices
 * 2. Hvis 404: søg efter fakturaen via fakturanummer (håndterer ID-mismatch i sandbox)
 * 3. Hvis stadig ikke fundet: redirect til HTML-print som fallback
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

  const baseUrl = process.env.NEXTAUTH_URL || 'https://portal.venmark.dk'

  try {
    const tenant  = process.env.BC_TENANT_ID
    const env     = process.env.BC_ENVIRONMENT_NAME
    const company = process.env.BC_COMPANY_ID
    const bcBase  = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies(${company})`

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
    const authHeader = { Authorization: `Bearer ${token}` }

    // Forsøg 1: direkte ID-opslag
    console.log('[PDF] forsøg 1 — direkte ID:', invoiceId)
    let pdfRes = await fetch(
      `${bcBase}/salesInvoices(${invoiceId})/pdfDocument/$value`,
      { headers: { ...authHeader, Accept: 'application/pdf' } },
    )

    // Forsøg 2: opslag via fakturanummer (håndterer ID-mismatch i sandbox)
    if (pdfRes.status === 404) {
      console.log('[PDF] forsøg 2 — søg via nummer:', invoice.number)
      const lookupRes = await fetch(
        `${bcBase}/salesInvoices?$filter=number eq '${invoice.number}'&$select=id`,
        { headers: authHeader },
      )
      if (lookupRes.ok) {
        const { value } = await lookupRes.json()
        const altId = value?.[0]?.id
        if (altId && altId !== invoiceId) {
          console.log('[PDF] fandt alternativt ID:', altId)
          pdfRes = await fetch(
            `${bcBase}/salesInvoices(${altId})/pdfDocument/$value`,
            { headers: { ...authHeader, Accept: 'application/pdf' } },
          )
        }
      }
    }

    // Fallback: redirect til HTML-print
    if (pdfRes.status === 404) {
      console.log('[PDF] ikke i BC standard API, fallback til HTML-print')
      return NextResponse.redirect(
        new URL(`/portal/fakturaer/${invoice.number}/print?print=1`, baseUrl)
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
