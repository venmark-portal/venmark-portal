import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { getT } from '@/lib/leverandoer/i18n'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // Accept enten NextAuth-session (portal) eller BC_PORTAL_API_KEY (BC codeunit)
  const apiKey = req.headers.get('x-api-key')
  if (apiKey !== process.env.BC_PORTAL_API_KEY) {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any)?.role !== 'admin')
      return new NextResponse('Unauthorized', { status: 401 })
  }

  const { bcVendorNo, vendorName, vendorEmail, lang } = await req.json()
  if (!bcVendorNo || !vendorEmail)
    return NextResponse.json({ error: 'bcVendorNo og vendorEmail er påkrævet' }, { status: 400 })

  // Find eller opret erklæring
  let decl = await prisma.supplierDeclaration.findFirst({
    where: { bcVendorNo, status: { in: ['PENDING', 'SUBMITTED'] } },
    orderBy: { createdAt: 'desc' },
  })

  if (!decl) {
    decl = await prisma.supplierDeclaration.create({
      data: {
        bcVendorNo,
        lang: lang ?? 'en',
        companyName: vendorName ?? null,
        email: vendorEmail,
        status: 'PENDING',
        nextRenewalDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    })
  }

  const url = `${process.env.APP_URL}/leverandoer/${decl.token}`
  const t = getT(decl.lang)

  await sendEmail({
    to: vendorEmail,
    subject: t.title + ' — Venmark Fisk A/S',
    text: `${vendorName ? `Kære ${vendorName},\n\n` : ''}Venmark Fisk A/S anmoder om udfyldelse af leverandørerklæring.\n\nBrug linket herunder:\n${url}\n\nLinket er personligt og udløber ikke.\n\nMed venlig hilsen\nVenmark Fisk A/S`,
  })

  await prisma.supplierReminderLog.create({
    data: { declarationId: decl.id, type: 'INITIAL', sentTo: vendorEmail },
  })

  return NextResponse.json({ ok: true, token: decl.token })
}
