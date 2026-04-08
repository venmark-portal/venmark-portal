import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPostedCreditMemos, getAccessToken } from '@/lib/businesscentral'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  }

  const customerNo   = (session.user as any)?.bcCustomerNumber as string ?? ''
  const creditMemoId = params.id

  const threeYearsAgo = new Date()
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3)
  const creditMemos = await getPostedCreditMemos(customerNo, threeYearsAgo.toISOString().split('T')[0])
  const creditMemo  = creditMemos.find(cm => cm.id === creditMemoId)

  if (!creditMemo) {
    return NextResponse.json({ error: 'Kreditnota ikke fundet' }, { status: 404 })
  }

  const baseUrl = process.env.NEXTAUTH_URL || 'https://portal.venmark.dk'

  try {
    const tenant  = process.env.BC_TENANT_ID
    const env     = process.env.BC_ENVIRONMENT_NAME
    const company = process.env.BC_COMPANY_ID
    const token   = await getAccessToken()
    const authHeader = { Authorization: `Bearer ${token}` }

    const customBase = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`

    // Forsøg 1: custom endpoint → standard kreditnota rapport som PDF
    console.log('[PDF-KN] forsøg 1 — custom endpoint for:', creditMemo.number)
    const customRes = await fetch(
      `${customBase}/postedCreditMemoPdfs(${creditMemoId})`,
      { headers: authHeader },
    )

    if (customRes.ok) {
      const data = await customRes.json()
      if (data.pdfBase64) {
        console.log('[PDF-KN] custom endpoint OK')
        const pdfBuffer = Buffer.from(data.pdfBase64, 'base64')
        return new NextResponse(pdfBuffer, {
          status: 200,
          headers: {
            'Content-Type':        'application/pdf',
            'Content-Disposition': `inline; filename="Kreditnota-${creditMemo.number}.pdf"`,
            'Content-Length':      String(pdfBuffer.byteLength),
          },
        })
      }
    } else {
      console.log('[PDF-KN] custom endpoint fejlede:', customRes.status)
    }

    // Forsøg 2: standard v2.0 salesCreditMemos
    const bcBase = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies(${company})`
    console.log('[PDF-KN] forsøg 2 — standard v2.0 salesCreditMemos')
    const pdfRes = await fetch(
      `${bcBase}/salesCreditMemos(${creditMemoId})/pdfDocument/$value`,
      { headers: { ...authHeader, Accept: 'application/pdf' } },
    )

    if (pdfRes.ok) {
      const pdfBuffer = await pdfRes.arrayBuffer()
      return new NextResponse(pdfBuffer, {
        status: 200,
        headers: {
          'Content-Type':        'application/pdf',
          'Content-Disposition': `inline; filename="Kreditnota-${creditMemo.number}.pdf"`,
          'Content-Length':      String(pdfBuffer.byteLength),
        },
      })
    }

    // Forsøg 3: HTML-print fallback
    console.log('[PDF-KN] fallback til HTML-print')
    return NextResponse.redirect(
      new URL(`/portal/kreditnotaer/${creditMemo.number}/print?print=1`, baseUrl)
    )

  } catch (e: any) {
    console.error('[PDF-KN] fejl:', e)
    return NextResponse.json({ error: 'Kunne ikke hente PDF' }, { status: 500 })
  }
}
