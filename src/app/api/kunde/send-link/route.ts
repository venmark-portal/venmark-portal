import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { sendEmail } from '@/lib/email'

export const runtime = 'nodejs'

// Kaldes af BC (cu 50460 SendPortalLink) med x-api-key — mailer onboarding-linket.
// BC har allerede oprettet onboarding-record'en med tokenet; portalen sender kun mailen.
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (apiKey !== process.env.BC_PORTAL_API_KEY) {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any)?.role !== 'admin')
      return new NextResponse('Unauthorized', { status: 401 })
  }

  const { token, customerName, email, lang } = await req.json()
  if (!token || !email)
    return NextResponse.json({ error: 'token og email er påkrævet' }, { status: 400 })

  const url = `${process.env.APP_URL}/kunde/${token}`
  const da = (lang ?? 'da') !== 'en'

  const subject = da ? 'Kundeoprettelse hos Venmark Fisk A/S' : 'Customer onboarding — Venmark Fisk A/S'
  const text = da
    ? `${customerName ? `Kære ${customerName},\n\n` : ''}Velkommen som kunde hos Venmark Fisk A/S.\n\nUdfyld og underskriv jeres oplysninger via linket herunder — det tager få minutter:\n${url}\n\nMed venlig hilsen\nVenmark Fisk A/S`
    : `${customerName ? `Dear ${customerName},\n\n` : ''}Welcome as a customer at Venmark Fisk A/S.\n\nPlease complete and sign your details via the link below — it takes a few minutes:\n${url}\n\nKind regards\nVenmark Fisk A/S`

  await sendEmail({ to: email, subject, text })
  return NextResponse.json({ ok: true })
}
