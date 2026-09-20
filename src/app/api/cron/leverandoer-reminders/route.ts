import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { getT } from '@/lib/leverandoer/i18n'
import { createRenewalDeclaration, isRoundMail } from '@/lib/leverandoer/renewal'

export const runtime = 'nodejs'

const DAY = 24 * 60 * 60 * 1000
const RENEWAL_LEAD_DAYS = 45      // start fornyelsesrunde 45 dage før nextRenewalDate
const RENEWAL_INTERVAL_DAYS = 7   // ugentlige rykkere
const RENEWAL_CC_FROM = 3         // fra 3. mail er kvalitetsansvarlig CC

// Køres DAGLIGT fra serverens crontab (08:00) med x-cron-secret.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET)
    return new NextResponse('Unauthorized', { status: 401 })

  const now = new Date()
  const settings = await prisma.portalSettings.findUnique({ where: { id: 'default' } })
  const kvalitetschefEmail = settings?.kvalitetschefEmail || process.env.NOTIFICATION_EMAIL || ''
  const appUrl = process.env.APP_URL
  const fmt = (d: Date) => d.toLocaleDateString('da-DK', { timeZone: 'Europe/Copenhagen' })

  // Alle erklæringer, nyeste først — vi arbejder pr. kreditor
  const all = await prisma.supplierDeclaration.findMany({
    orderBy: { createdAt: 'desc' },
    include: { reminders: { orderBy: { sentAt: 'desc' } } },
  })
  const byVendor = new Map<string, typeof all>()
  for (const d of all) byVendor.set(d.bcVendorNo, [...(byVendor.get(d.bcVendorNo) ?? []), d])

  const escalationList: { name: string; vendorNo: string; monthsOverdue: number }[] = []
  let remindersSent = 0, renewalsStarted = 0, renewalRemindersSent = 0, expired = 0

  for (const [vendorNo, decls] of Array.from(byVendor.entries())) {
    const latest = decls[0]
    // Seneste afsluttede runde (godkendt — eller godkendt og siden udløbet). Afgør om en
    // PENDING er en FORNYELSESrunde (B) eller en førstegangs-erklæring (C).
    const lastApproved = decls.find(d => d.status === 'APPROVED' || d.status === 'EXPIRED')
    const name = latest.companyName || vendorNo

    // ── A. Start fornyelsesrunde: nyeste er godkendt og fornyelse < 45 dage væk ──────────
    if (latest.status === 'APPROVED' && latest.nextRenewalDate
        && latest.nextRenewalDate.getTime() - now.getTime() <= RENEWAL_LEAD_DAYS * DAY) {
      const to = latest.email || latest.signerEmail
      if (!to) continue
      const round = await createRenewalDeclaration(vendorNo, latest, {})
      await sendRenewalMail(round, 1, to, [round.ccEmail], latest.nextRenewalDate)
      await prisma.supplierReminderLog.create({ data: { declarationId: round.id, type: 'RENEWAL_1', sentTo: to } })
      renewalsStarted++
      continue
    }

    // ── B. Igangværende fornyelsesrunde: PENDING-kopi hos kreditor med tidligere godkendelse ─
    if (latest.status === 'PENDING' && lastApproved) {
      const roundMails = latest.reminders.filter(r => isRoundMail(r.type))
      const n = roundMails.length + 1                       // næste rykkernummer
      const last = roundMails[0]?.sentAt ?? latest.createdAt
      const daysSince = (now.getTime() - last.getTime()) / DAY
      const to = latest.email || latest.signerEmail
      const renewalDate = lastApproved.nextRenewalDate
      // Ugentlige rykkere kun inden for 45-dages-vinduet (eller når cron'en selv startede
      // runden) — en manuel "Gensend link" et halvt år før skal ikke udløse et års nagging.
      const inWindow = !renewalDate || renewalDate.getTime() - now.getTime() <= RENEWAL_LEAD_DAYS * DAY
      const cronStarted = roundMails.some(r => r.type.startsWith('RENEWAL_'))

      if (to && (inWindow || cronStarted) && daysSince >= RENEWAL_INTERVAL_DAYS) {
        const cc = [latest.ccEmail, n >= RENEWAL_CC_FROM ? kvalitetschefEmail : null]
        await sendRenewalMail(latest, n, to, cc, renewalDate)
        await prisma.supplierReminderLog.create({ data: { declarationId: latest.id, type: `RENEWAL_${n}`, sentTo: to } })
        renewalRemindersSent++
      }

      // Fornyelsesdato passeret uden ny indsendelse → den gamle godkendelse er udløbet (også i BC).
      // Kun én gang: status-skiftet APPROVED→EXPIRED gør betingelsen falsk næste dag.
      if (lastApproved.status === 'APPROVED' && renewalDate && renewalDate.getTime() < now.getTime()) {
        await prisma.supplierDeclaration.update({ where: { id: lastApproved.id }, data: { status: 'EXPIRED' } })
        try { await updateBCVendorStatus(vendorNo, 'Udlobet', null) } catch (e) { console.error('BC Udlobet fejlede:', e) }
        expired++
      }
      continue
    }

    // ── C. Førstegangs-erklæring der aldrig blev færdig (ingen tidligere godkendelse) ───────
    // Gammel logik: 10 mdr → ugentlig reminder, 11 mdr → eskalering til kvalitetschef.
    if (lastApproved || latest.status === 'APPROVED') continue
    const decl = latest
    const recipientEmail = decl.signerEmail || decl.email || ''
    if (!recipientEmail) continue
    const t = getT(decl.lang)
    const url = `${appUrl}/leverandoer/${decl.token}`
    const monthsOld = (now.getTime() - (decl.submittedAt || decl.createdAt).getTime()) / (30 * DAY)
    const lastReminder = decl.reminders.find(r => r.type !== 'INITIAL')
    const daysSinceLast = lastReminder ? (now.getTime() - lastReminder.sentAt.getTime()) / DAY : 999

    if (monthsOld >= 11) {
      escalationList.push({ name, vendorNo, monthsOverdue: Math.floor(monthsOld - 10) })
      if (daysSinceLast >= 6) {
        await sendEmail({
          to: recipientEmail, cc: decl.ccEmail ?? undefined,
          subject: `${t.title} — Påmindelse (${Math.floor(monthsOld)} måneder siden)`,
          text: `Kære ${name},\n\nVenmark Fisk A/S mangler fortsat jeres leverandørerklæring.\nDen er nu ${Math.floor(monthsOld)} måneder gammel.\n\nUdfyld her: ${url}\n\nMed venlig hilsen\nVenmark Fisk A/S`,
        })
        await prisma.supplierReminderLog.create({ data: { declarationId: decl.id, type: 'ESCALATION_11M', sentTo: recipientEmail } })
        remindersSent++
      }
    } else if (monthsOld >= 10 && daysSinceLast >= 6) {
      await sendEmail({
        to: recipientEmail, cc: decl.ccEmail ?? undefined,
        subject: `${t.title} — Fornyelse påkrævet snart`,
        text: `Kære ${name},\n\nJeres leverandørerklæring til Venmark Fisk A/S skal fornyes inden for den næste måned.\n\nUdfyld eller bekræft her: ${url}\n\nMed venlig hilsen\nVenmark Fisk A/S`,
      })
      await prisma.supplierReminderLog.create({ data: { declarationId: decl.id, type: 'REMINDER_10M', sentTo: recipientEmail } })
      remindersSent++
    }
  }

  // ── Dokument-udløb ──────────────────────────────────────────────────────────
  // Dokumenter med udløbsdato inden 30 dage (eller allerede udløbet) på leverandørens NYESTE
  // erklæring → mail til leverandøren (højst hver 14. dag pr. erklæring) + med i kvalitetschef-
  // mailen. Ældre erklæringer ignoreres, ellers rykker vi for sidste års dokumenter.
  const latestIds = Array.from(byVendor.values()).map(ds => ds[0].id)
  const in30Days = new Date(now.getTime() + 30 * DAY)
  const expiringDocs = await prisma.supplierDocument.findMany({
    where: { declarationId: { in: latestIds }, expiresAt: { not: null, lte: in30Days } },
    orderBy: { expiresAt: 'asc' },
  })
  const docsByDecl = new Map<string, typeof expiringDocs>()
  for (const doc of expiringDocs) docsByDecl.set(doc.declarationId, [...(docsByDecl.get(doc.declarationId) ?? []), doc])

  const docExpiryList: string[] = []
  let docRemindersSent = 0
  for (const [declId, docs] of Array.from(docsByDecl.entries())) {
    const decl = all.find(d => d.id === declId)
    if (!decl) continue
    const t = getT(decl.lang)
    const docLines = docs.map(x => `• ${t.docTypes[x.docType] ?? x.docType} — ${x.fileName} (${x.expiresAt!.getTime() < now.getTime() ? 'udløbet' : 'udløber'} ${fmt(x.expiresAt!)})`)
    docExpiryList.push(`${decl.companyName || decl.bcVendorNo} (${decl.bcVendorNo}):\n${docLines.map(l => '  ' + l).join('\n')}`)

    const recipientEmail = decl.email || decl.signerEmail || ''
    if (!recipientEmail) continue
    const lastDocReminder = decl.reminders.find(r => r.type === 'DOC_EXPIRY')
    const daysSinceLast = lastDocReminder ? (now.getTime() - lastDocReminder.sentAt.getTime()) / DAY : 999
    if (daysSinceLast < 14) continue

    const url = `${appUrl}/leverandoer/${decl.token}`
    await sendEmail({
      to: recipientEmail,
      cc: decl.ccEmail ?? (decl.signerEmail && decl.signerEmail !== recipientEmail ? decl.signerEmail : undefined),
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
      text: `${parts.join('\n\n')}\n\nOversigt: ${appUrl}/admin/leverandoerer`,
    })
  }

  return NextResponse.json({ ok: true, remindersSent, renewalsStarted, renewalRemindersSent, expired, docRemindersSent, escalations: escalationList.length, expiringDocs: expiringDocs.length })
}

// Fornyelsesmail nr. n (DA + EN). cc filtreres for tomme/dubletter.
async function sendRenewalMail(
  decl: { token: string; lang: string; companyName: string | null; bcVendorNo: string },
  n: number, to: string, cc: (string | null | undefined)[], renewalDate: Date | null,
) {
  const t = getT(decl.lang)
  const url = `${process.env.APP_URL}/leverandoer/${decl.token}`
  const name = decl.companyName || decl.bcVendorNo
  const dateDa = renewalDate ? renewalDate.toLocaleDateString('da-DK', { timeZone: 'Europe/Copenhagen' }) : ''
  const dateEn = renewalDate ? renewalDate.toLocaleDateString('en-GB', { timeZone: 'Europe/Copenhagen' }) : ''
  const ccList = Array.from(new Set(cc.filter((x): x is string => !!x && x.toLowerCase() !== to.toLowerCase())))
  const first = n === 1
  await sendEmail({
    to, cc: ccList.length ? ccList.join(', ') : undefined,
    subject: first
      ? `${t.title} — årlig fornyelse / annual renewal`
      : `${t.title} — påmindelse ${n} / reminder ${n}`,
    text:
      `Kære ${name},\n\n` +
      (first
        ? `Jeres leverandørerklæring hos Venmark Fisk A/S skal fornyes senest ${dateDa}. Formularen er forudfyldt med jeres seneste oplysninger — I skal kun rette det der har ændret sig, uploade nye dokumenter og underskrive.`
        : `Dette er påmindelse nr. ${n}: jeres leverandørerklæring hos Venmark Fisk A/S skal fornyes senest ${dateDa}. Formularen er forudfyldt — ret kun det der har ændret sig, og underskriv.`) +
      `\n\nÅbn her:\n${url}\n\n---\n\nDear ${name},\n\n` +
      (first
        ? `Your supplier declaration with Venmark Fisk A/S is due for renewal by ${dateEn}. The form is pre-filled with your latest details — only update what has changed, upload new documents and sign.`
        : `This is reminder no. ${n}: your supplier declaration with Venmark Fisk A/S must be renewed by ${dateEn}. The form is pre-filled — only update what has changed, and sign.`) +
      `\n\nOpen here:\n${url}\n\nVenmark Fisk A/S`,
  })
}

// Spejler updateBCVendorStatus i [token]/route.ts — PATCH'er vendorDeclarationStatuses i BC.
async function updateBCVendorStatus(vendorNo: string, status: string, nextRenewal: Date | null) {
  const { getAccessToken, bcPortalBaseUrl } = await import('@/lib/businesscentral')
  const token = await getAccessToken()
  const base = bcPortalBaseUrl()
  const bcEnum = (s: string) => s.replace(/ /g, '_x0020_')
  const bcDate = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const res = await fetch(`${base}/vendorDeclarationStatuses('${vendorNo}')`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': '*' },
    body: JSON.stringify({ erklaeringStatus: bcEnum(status), ...(nextRenewal ? { naestFornyelsesdato: bcDate(nextRenewal) } : {}) }),
  })
  if (!res.ok) console.error(`BC vendorDeclarationStatuses PATCH (${status}) fejlede (${res.status}):`, (await res.text()).slice(0, 300))
}
