import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { getT } from '@/lib/leverandoer/i18n'

export const runtime = 'nodejs'

// Køres ugentligt — BC Job Queue kalder denne endpoint
// Også tilgængelig via /api/cron/leverandoer-reminders med CRON_SECRET header
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET)
    return new NextResponse('Unauthorized', { status: 401 })

  const now = new Date()
  const tenMonths  = new Date(now.getTime() - 10 * 30 * 24 * 60 * 60 * 1000)
  const elevenMonths = new Date(now.getTime() - 11 * 30 * 24 * 60 * 60 * 1000)

  // Hent alle aktive erklæringer
  const declarations = await prisma.supplierDeclaration.findMany({
    where: { status: { in: ['PENDING', 'SUBMITTED', 'APPROVED'] } },
    include: { reminders: { orderBy: { sentAt: 'desc' }, take: 1 } },
  })

  const settings = await prisma.portalSettings.findUnique({ where: { id: 'default' } })
  const kvalitetschefEmail = settings?.kvalitetschefEmail || process.env.NOTIFICATION_EMAIL || ''

  const escalationList: { name: string; vendorNo: string; monthsOverdue: number }[] = []
  let remindersSent = 0

  for (const decl of declarations) {
    if (!decl.email && !decl.signerEmail) continue
    const recipientEmail = decl.signerEmail || decl.email || ''
    const t = getT(decl.lang)
    const url = `${process.env.APP_URL}/leverandoer/${decl.token}`

    const lastUpdated = decl.submittedAt || decl.createdAt
    const monthsOld = (now.getTime() - lastUpdated.getTime()) / (30 * 24 * 60 * 60 * 1000)

    // 11+ måneder og ikke godkendt → eskalering
    if (monthsOld >= 11 && decl.status !== 'APPROVED') {
      escalationList.push({
        name: decl.companyName || decl.bcVendorNo,
        vendorNo: decl.bcVendorNo,
        monthsOverdue: Math.floor(monthsOld - 10),
      })

      // Send også reminder til leverandør (ugentligt)
      const lastReminder = decl.reminders[0]
      const daysSinceLast = lastReminder
        ? (now.getTime() - lastReminder.sentAt.getTime()) / (24 * 60 * 60 * 1000)
        : 999

      if (daysSinceLast >= 6) {
        await sendEmail({
          to: recipientEmail,
          subject: `${t.title} — Påmindelse (${Math.floor(monthsOld)} måneder siden)`,
          text: `Kære ${decl.companyName || decl.bcVendorNo},\n\nVenmark Fisk A/S mangler fortsat jeres leverandørerklæring.\nDen er nu ${Math.floor(monthsOld)} måneder gammel.\n\nUdfyld her: ${url}\n\nMed venlig hilsen\nVenmark Fisk A/S`,
        })
        await prisma.supplierReminderLog.create({
          data: { declarationId: decl.id, type: 'ESCALATION_11M', sentTo: recipientEmail },
        })
        remindersSent++
      }
      continue
    }

    // 10–11 måneder → ugentlig reminder til leverandør
    if (monthsOld >= 10 && decl.status !== 'APPROVED') {
      const lastReminder = decl.reminders[0]
      const daysSinceLast = lastReminder
        ? (now.getTime() - lastReminder.sentAt.getTime()) / (24 * 60 * 60 * 1000)
        : 999

      if (daysSinceLast >= 6) {
        await sendEmail({
          to: recipientEmail,
          subject: `${t.title} — Fornyelse påkrævet snart`,
          text: `Kære ${decl.companyName || decl.bcVendorNo},\n\nJeres leverandørerklæring til Venmark Fisk A/S skal fornyes inden for den næste måned.\n\nUdfyld eller bekræft her: ${url}\n\nMed venlig hilsen\nVenmark Fisk A/S`,
        })
        await prisma.supplierReminderLog.create({
          data: { declarationId: decl.id, type: 'REMINDER_10M', sentTo: recipientEmail },
        })
        remindersSent++
      }
    }
  }

  // ── Dokument-udløb ──────────────────────────────────────────────────────────
  // Dokumenter med udløbsdato inden 30 dage (eller allerede udløbet) på leverandørens NYESTE
  // erklæring → mail til leverandøren (højst hver 14. dag pr. erklæring) + med i kvalitetschef-
  // mailen. Ældre erklæringer ignoreres, ellers rykker vi for sidste års dokumenter.
  const latestByVendor = new Map<string, typeof declarations[number]>()
  for (const d of [...declarations].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()))
    if (!latestByVendor.has(d.bcVendorNo)) latestByVendor.set(d.bcVendorNo, d)

  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const expiringDocs = await prisma.supplierDocument.findMany({
    where: { declarationId: { in: Array.from(latestByVendor.values()).map(d => d.id) }, expiresAt: { not: null, lte: in30Days } },
    orderBy: { expiresAt: 'asc' },
  })
  const docsByDecl = new Map<string, typeof expiringDocs>()
  for (const doc of expiringDocs) docsByDecl.set(doc.declarationId, [...(docsByDecl.get(doc.declarationId) ?? []), doc])

  const docExpiryList: string[] = []
  let docRemindersSent = 0
  for (const [declId, docs] of Array.from(docsByDecl.entries())) {
    const decl = declarations.find(d => d.id === declId)
    if (!decl) continue
    const t = getT(decl.lang)
    const fmt = (d: Date) => d.toLocaleDateString('da-DK')
    const docLines = docs.map(x => `• ${t.docTypes[x.docType] ?? x.docType} — ${x.fileName} (${x.expiresAt!.getTime() < now.getTime() ? 'udløbet' : 'udløber'} ${fmt(x.expiresAt!)})`)
    docExpiryList.push(`${decl.companyName || decl.bcVendorNo} (${decl.bcVendorNo}):\n${docLines.map(l => '  ' + l).join('\n')}`)

    const recipientEmail = decl.email || decl.signerEmail || ''
    if (!recipientEmail) continue
    const lastDocReminder = await prisma.supplierReminderLog.findFirst({
      where: { declarationId: declId, type: 'DOC_EXPIRY' }, orderBy: { sentAt: 'desc' },
    })
    const daysSinceLast = lastDocReminder ? (now.getTime() - lastDocReminder.sentAt.getTime()) / (24 * 60 * 60 * 1000) : 999
    if (daysSinceLast < 14) continue

    const url = `${process.env.APP_URL}/leverandoer/${decl.token}`
    await sendEmail({
      to: recipientEmail,
      cc: decl.signerEmail && decl.signerEmail !== recipientEmail ? decl.signerEmail : undefined,
      subject: `${t.title} — ${docs.length} dokument(er) udløber / expiring documents`,
      text: `Kære ${decl.companyName || decl.bcVendorNo},\n\nFølgende dokumenter hos Venmark Fisk A/S er udløbet eller udløber snart:\n\n${docLines.join('\n')}\n\nUpload venligst de nye versioner her:\n${url}\n\n---\n\nDear ${decl.companyName || decl.bcVendorNo},\n\nThe following documents on file with Venmark Fisk A/S have expired or are about to expire:\n\n${docLines.join('\n')}\n\nPlease upload the new versions here:\n${url}\n\nVenmark Fisk A/S`,
    })
    await prisma.supplierReminderLog.create({ data: { declarationId: declId, type: 'DOC_EXPIRY', sentTo: recipientEmail } })
    docRemindersSent++
  }

  // Send samlet eskaleringsmail til kvalitetschef
  if ((escalationList.length > 0 || docExpiryList.length > 0) && kvalitetschefEmail) {
    const lines = escalationList
      .map(e => `• ${e.name} (${e.vendorNo}) — ${e.monthsOverdue} måned(er) overskredet`)
      .join('\n')
    const parts: string[] = []
    if (escalationList.length) parts.push(`Følgende leverandører mangler leverandørerklæring og er overskredet 11 måneder:\n\n${lines}`)
    if (docExpiryList.length) parts.push(`Dokumenter der er udløbet eller udløber inden 30 dage:\n\n${docExpiryList.join('\n\n')}`)

    await sendEmail({
      to: kvalitetschefEmail,
      subject: escalationList.length
        ? `⚠️ ${escalationList.length} leverandørerklæring(er) overskredet 11 måneder${docExpiryList.length ? ` · ${expiringDocs.length} dokument(er) udløber` : ''}`
        : `⚠️ ${expiringDocs.length} leverandørdokument(er) udløbet/udløber snart`,
      text: `${parts.join('\n\n')}\n\nOversigt: ${process.env.APP_URL}/admin/leverandoerer`,
    })
  }

  return NextResponse.json({ ok: true, remindersSent, docRemindersSent, escalations: escalationList.length, expiringDocs: expiringDocs.length })
}
