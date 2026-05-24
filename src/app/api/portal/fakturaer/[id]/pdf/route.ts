import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPostedInvoices, getAccessToken } from '@/lib/businesscentral'

export const runtime = 'nodejs'

/**
 * GET /api/portal/fakturaer/[id]/pdf
 * [id] = portal API invoice id (systemId fra Sales Invoice Header)
 *
 * Strategi:
 * 1. Kald bound action generatePdf på custom portal API page 50170 (virker for ALLE fakturaer)
 * 2. Fallback: standard v2.0 salesInvoices pdfDocument (kun nyere fakturaer)
 * 3. Fallback: HTML-print siden
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
    const token   = await getAccessToken()
    const authHeader = { Authorization: `Bearer ${token}` }

    const customBase = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`

    // Forsøg 0: postedInvoicePdfs API (page 50175) — altid rapport 50040, Venmark-skabelon
    console.log('[PDF] forsøg 0 — postedInvoicePdfs (rapport 50040) for:', invoice.number)
    const pdfApiRes = await fetch(
      `${customBase}/postedInvoicePdfs(${invoiceId})`,
      { headers: authHeader },
    )
    if (pdfApiRes.ok) {
      const pdfData = await pdfApiRes.json()
      const pdfBase64 = pdfData.pdfBase64 ?? ''
      if (pdfBase64.length > 100) {
        console.log('[PDF] genereret via postedInvoicePdfs, base64 længde:', pdfBase64.length)
        const pdfBuffer = Buffer.from(pdfBase64, 'base64')
        return new NextResponse(pdfBuffer, {
          status: 200,
          headers: {
            'Content-Type':        'application/pdf',
            'Content-Disposition': `inline; filename="Faktura-${invoice.number}.pdf"`,
            'Content-Length':      String(pdfBuffer.byteLength),
          },
        })
      }
      console.log('[PDF] postedInvoicePdfs PDF tom (0 chars):', pdfBase64.length, '— prøver bound action')
    } else {
      console.log('[PDF] postedInvoicePdfs fejlede:', pdfApiRes.status)
    }

    // Forsøg 1: bound action generatePdf på portal API page 50170
    console.log('[PDF] forsøg 1 — generatePdf bound action for:', invoice.number)
    const genRes = await fetch(
      `${customBase}/postedSalesInvoices(${invoiceId})/Microsoft.NAV.generatePdf`,
      {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: '{}',
      },
    )

    if (genRes.ok) {
      const { value: pdfBase64 } = await genRes.json()
      // Under 25 KB base64 = tom/blank Word-skabelon — spring over
      if (pdfBase64 && pdfBase64.length > 25_000) {
        console.log('[PDF] genereret via bound action, base64 længde:', pdfBase64.length)
        const pdfBuffer = Buffer.from(pdfBase64, 'base64')
        return new NextResponse(pdfBuffer, {
          status: 200,
          headers: {
            'Content-Type':        'application/pdf',
            'Content-Disposition': `inline; filename="Faktura-${invoice.number}.pdf"`,
            'Content-Length':      String(pdfBuffer.byteLength),
          },
        })
      } else {
        console.log('[PDF] bound action PDF for lille:', pdfBase64?.length ?? 0, '— prøver v2.0 fallback')
      }
    } else {
      console.log('[PDF] bound action fejlede:', genRes.status, await genRes.text().catch(() => ''))
    }

    // Forsøg 2: standard v2.0 salesInvoices pdfDocument (fallback for nyere fakturaer)
    const bcBase = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies(${company})`

    console.log('[PDF] forsøg 2 — standard salesInvoices pdfDocument')
    let pdfRes = await fetch(
      `${bcBase}/salesInvoices(${invoiceId})/pdfDocument/$value`,
      { headers: { ...authHeader, Accept: 'application/pdf' } },
    )

    // Forsøg 2b: søg via fakturanummer (ID-mismatch i sandbox)
    if (pdfRes.status === 404) {
      console.log('[PDF] forsøg 2b — søg via nummer:', invoice.number)
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

    if (pdfRes.ok) {
      const pdfBuffer = await pdfRes.arrayBuffer()
      return new NextResponse(pdfBuffer, {
        status: 200,
        headers: {
          'Content-Type':        'application/pdf',
          'Content-Disposition': `inline; filename="Faktura-${invoice.number}.pdf"`,
          'Content-Length':      String(pdfBuffer.byteLength),
        },
      })
    }

    // Forsøg 3: HTML-print fallback
    console.log('[PDF] alle BC-forsøg fejlede, fallback til HTML-print')
    return NextResponse.redirect(
      new URL(`/portal/fakturaer/${invoice.number}/print?print=1`, baseUrl)
    )

  } catch (e: any) {
    console.error('[PDF] fejl:', e)
    return NextResponse.json({ error: 'Kunne ikke hente PDF' }, { status: 500 })
  }
}
