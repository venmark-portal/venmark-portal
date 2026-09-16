import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getOnboardingByToken, patchOnboarding } from '@/lib/kunde/onboarding-bc'
import { buildOnboardingPdf } from '@/lib/kunde/onboarding-pdf'
import { TERMS_VERSION } from '@/lib/kunde/content'
import { sendEmail } from '@/lib/email'

export const runtime = 'nodejs'

// GET — hent onboarding-record via token (til forudfyldning)
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const rec = await getOnboardingByToken(params.token)
    if (!rec) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json(rec)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 })
  }
}

const DOCTYPE_MAP: Record<string, string> = {
  oc: 'OrderConfirmation', inv: 'Invoice', cm: 'CreditMemo',
  stmt: 'Statement', dn: 'DeliveryNote', pl: 'Prisliste',
}

// POST — indsend udfyldt + underskrevet formular (JSON)
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const rec = await getOnboardingByToken(params.token)
  if (!rec) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (rec.status === 'Godkendt') return NextResponse.json({ error: 'already_approved' }, { status: 400 })

  const b = await req.json()
  const isLs = (b.variant === 'ls')
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''

  const co = b.company || {}
  const g = b.guarantor || {}
  const ls = b.ls || {}
  const cs = b.consents || {}
  const contacts = Array.isArray(b.contacts) ? b.contacts : []

  const docEmails = (Array.isArray(b.docEmails) ? b.docEmails : [])
    .map((x: any) => ({ type: DOCTYPE_MAP[x.type] || x.type, emails: (x.emails || []).filter(Boolean) }))
    .filter((x: any) => x.emails.length)

  const guarantorAddress = [g.addressStreet, [g.zip, g.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ')

  // Byg PDF (med underskrifter) FØR patch, så pdfUrl kan med i én skrivning
  let pdfBuf: Buffer | null = null
  try {
    pdfBuf = await buildOnboardingPdf({
      lang: b.lang === 'en' ? 'en' : 'da',
      variant: isLs ? 'ls' : 'std',
      companyName: co.name, vatRegistrationNo: co.vat, companyForm: co.form,
      address: co.address, postCode: co.postCode, city: co.city, countryRegionCode: co.country,
      eInvoiceEan: !!co.eInvoiceEan, gln: co.gln, website: co.website,
      contacts, phoneNo: b.phoneNo, email: b.email,
      docEmails, expectedMonthlyPurchase: b.monthly, prislisteSprog: b.prislisteSprog,
      lsBankName: ls.bank, lsRegNo: ls.reg, lsAccountNo: ls.acc,
      guarantorName: g.name, guarantorCpr: g.cpr, guarantorAddress,
      signPlace: b.signPlace, signDate: b.signDate, signerName: b.signerName,
      marketingConsent: !!cs.marketing, sig1: b.sig1, sig2: b.sig2,
    })
  } catch (e) {
    console.error('Onboarding PDF fejlede:', e)
  }

  const appUrl = process.env.APP_URL || ''
  const pdfUrl = `${appUrl}/api/kunde/${params.token}/pdf`

  // Gem PDF på disk (serveres admin-guarded via /pdf-ruten)
  if (pdfBuf) {
    try {
      const dir = path.join(process.cwd(), 'uploads', 'onboarding')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${params.token}.pdf`), pdfBuf)
    } catch (e) { console.error('Kunne ikke gemme onboarding-PDF:', e) }
  }

  const patch: Record<string, any> = {
    status: 'Afventer',
    submittedAt: new Date().toISOString(),
    ipAddress: ip.slice(0, 50),
    companyName: co.name || '', vatRegistrationNo: co.vat || '', companyForm: co.form || '',
    address: co.address || '', postCode: co.postCode || '', city: co.city || '',
    countryRegionCode: co.country || '', eInvoiceEan: !!co.eInvoiceEan, gln: co.gln || '', website: co.website || '',
    contact1Name: contacts[0]?.name || '', contact1Mobile: contacts[0]?.mobile || '', contact1Email: contacts[0]?.email || '',
    contact2Name: contacts[1]?.name || '', contact2Mobile: contacts[1]?.mobile || '', contact2Email: contacts[1]?.email || '',
    contact3Name: contacts[2]?.name || '', contact3Mobile: contacts[2]?.mobile || '', contact3Email: contacts[2]?.email || '',
    phoneNo: b.phoneNo || '', email: b.email || '',
    docEmailsJson: JSON.stringify(docEmails).slice(0, 2048),
    prislisteSprog: b.prislisteSprog || '',
    expectedMonthlyPurchase: b.monthly ? Number(b.monthly) : 0,
    signPlace: b.signPlace || '', signDate: b.signDate || null,
    signerName: b.signerName || co.name || '',
    termsAccepted: !!cs.terms, termsVersion: TERMS_VERSION,
    gdprConsent: !!cs.gdpr, marketingConsent: !!cs.marketing, authorizedConfirm: !!cs.authorized,
    signedFirmategner: !!b.sig1,
    pdfUrl,
  }
  if (isLs) {
    patch.lsConsent = !!ls.consent
    patch.lsBankName = ls.bank || ''
    patch.lsRegNo = ls.reg || ''
    patch.lsAccountNo = ls.acc || ''
    patch.guarantorName = g.name || ''
    patch.guarantorCpr = g.cpr || ''
    patch.guarantorAddress = guarantorAddress
    patch.guarantyUnlimited = true
    patch.signedKautionist = !!b.sig2
  }

  try {
    await patchOnboarding(rec.id, patch)
  } catch (e: any) {
    console.error('BC onboarding PATCH fejlede:', e)
    return NextResponse.json({ error: 'bc_write_failed', detail: e.message }, { status: 502 })
  }

  // Mail til kunde + Venmark (med PDF vedhæftet)
  const attachments = pdfBuf ? [{ filename: 'Venmark-kundeoprettelse.pdf', content: pdfBuf, contentType: 'application/pdf' }] : undefined
  const da = b.lang !== 'en'
  try {
    if (b.email) {
      await sendEmail({
        to: b.email,
        subject: da ? 'Kvittering — kundeoprettelse hos Venmark Fisk A/S' : 'Receipt — customer onboarding at Venmark Fisk A/S',
        text: da
          ? 'Tak — vi har modtaget jeres oplysninger. En kopi af den underskrevne aftale er vedhæftet. Vi gennemgår og opretter jer som kunde.\n\nMed venlig hilsen\nVenmark Fisk A/S'
          : 'Thank you — we have received your details. A copy of the signed agreement is attached. We will review and set you up as a customer.\n\nKind regards\nVenmark Fisk A/S',
        attachments,
      })
    }
  } catch (e) { console.error('Kunde-kvitteringsmail fejlede:', e) }
  try {
    await sendEmail({
      to: process.env.NOTIFICATION_EMAIL || 'fisk@venmark.dk',
      subject: `Ny kundeoprettelse modtaget — ${co.name || rec.bcCustomerNo || ''}`,
      text: `Ny onboarding indsendt af ${co.name || ''} (CVR ${co.vat || ''}).\nVariant: ${isLs ? 'Med Leverandørservice + kaution' : 'Standard'}.\nGodkend i BC: Kunde onboarding-listen.`,
      attachments,
    })
  } catch (e) { console.error('Venmark-notifikationsmail fejlede:', e) }

  return NextResponse.json({ ok: true })
}
