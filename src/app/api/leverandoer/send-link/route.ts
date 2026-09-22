import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { getT } from '@/lib/leverandoer/i18n'
import { createRenewalDeclaration } from '@/lib/leverandoer/renewal'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // Accept enten NextAuth-session (portal) eller BC_PORTAL_API_KEY (BC codeunit)
  const apiKey = req.headers.get('x-api-key')
  if (apiKey !== process.env.BC_PORTAL_API_KEY) {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any)?.role !== 'admin')
      return new NextResponse('Unauthorized', { status: 401 })
  }

  // cc = leverandørens hovedmail når BC sender til en særskilt "Erklæring e-mail"
  // message = valgfri fritekst fra Venmark, sættes ØVERST i mailen (efter tiltalen)
  const { bcVendorNo, vendorName, vendorEmail, lang, cc, message } = await req.json()
  const messageTxt = typeof message === 'string' ? message.trim().slice(0, 2000) : ''
  if (!bcVendorNo || !vendorEmail)
    return NextResponse.json({ error: 'bcVendorNo og vendorEmail er påkrævet' }, { status: 400 })

  // Find en åben erklæring (PENDING/SUBMITTED) — den genbruges direkte (allerede forudfyldt).
  let decl = await prisma.supplierDeclaration.findFirst({
    where: { bcVendorNo, status: { in: ['PENDING', 'SUBMITTED'] } },
    orderBy: { createdAt: 'desc' },
  })

  const ccClean = typeof cc === 'string' && cc.trim() && cc.trim().toLowerCase() !== String(vendorEmail).toLowerCase() ? cc.trim() : null

  if (!decl) {
    // Ny runde (fx årlig fornyelse efter godkendelse): KOPIÉR forrige indsendelses data, så
    // leverandøren kun skal OPDATERE — ikke udfylde alt på ny (se lib/leverandoer/renewal.ts).
    const prev = await prisma.supplierDeclaration.findFirst({
      where: { bcVendorNo }, orderBy: { createdAt: 'desc' },
    })
    decl = await createRenewalDeclaration(bcVendorNo, prev, { vendorName, vendorEmail, lang, cc: ccClean })
  } else if (ccClean && decl.ccEmail !== ccClean) {
    // Gem CC på den åbne erklæring, så cron-rykkere også får hovedmailen med
    decl = await prisma.supplierDeclaration.update({ where: { id: decl.id }, data: { ccEmail: ccClean } })
  }

  const url = `${process.env.APP_URL}/leverandoer/${decl.token}`
  const t = getT(decl.lang)

  await sendEmail({
    to: vendorEmail,
    cc: decl.ccEmail ?? undefined,
    subject: t.title + ' — Venmark Fisk A/S',
    // Brødtekst på leverandørens sprog (decl.lang) — var hardcodet dansk
    text: `${vendorName ? `${t.mailDear ?? 'Dear'} ${vendorName},\n\n` : ''}${messageTxt ? `${messageTxt}\n\n` : ''}${t.mailRequest ?? 'Venmark Fisk A/S kindly asks you to complete the supplier declaration.'}\n\n${t.mailUseLink ?? 'Please use the link below:'}\n${url}\n\n${t.mailNoExpiry ?? 'The link is personal and does not expire.'}\n\n${t.mailRegards ?? 'Kind regards'}\nVenmark Fisk A/S`,
  })

  await prisma.supplierReminderLog.create({
    data: { declarationId: decl.id, type: 'INITIAL', sentTo: vendorEmail },
  })

  return NextResponse.json({ ok: true, token: decl.token })
}
