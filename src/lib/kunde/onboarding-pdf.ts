import { renderPdfFromHtml } from '@/lib/pricelist/render'
import { LEGAL, Lang } from './content'

export interface OnboardingPdfData {
  lang: Lang
  variant: 'std' | 'ls'
  guaranty?: boolean      // selvskyldnerkaution — uafhængig af variant
  companyName?: string
  vatRegistrationNo?: string
  companyForm?: string
  address?: string
  postCode?: string
  city?: string
  countryRegionCode?: string
  eInvoiceEan?: boolean
  gln?: string
  website?: string
  contacts?: { name?: string; mobile?: string; email?: string }[]
  phoneNo?: string
  email?: string
  docEmails?: { type: string; emails: string[] }[]
  expectedMonthlyPurchase?: string
  prislisteSprog?: string
  lsBankName?: string
  lsRegNo?: string
  lsAccountNo?: string
  guarantorName?: string
  guarantorCpr?: string
  guarantorAddress?: string
  signPlace?: string
  signDate?: string
  signerName?: string
  marketingConsent?: boolean
  sig1?: string   // data:image/png;base64,...
  sig2?: string
}

const T = {
  da: {
    title: 'Kundeoprettelse — underskrevet', company: 'Virksomhed', contacts: 'Kontaktpersoner',
    docmails: 'Dokument-modtagere', ls: 'Leverandørservice-mandat', guar: 'Selvskyldnerkaution',
    terms: 'Salgs- og leveringsbetingelser', gdpr: 'Behandling af personoplysninger (GDPR)',
    consent: 'Samtykke & underskrift', signer: 'Tegningsberettiget', guarantor: 'Kautionist',
    yes: 'Ja', no: 'Nej', place: 'Sted', date: 'Dato', marketing: 'Markedsføring (mail/SMS)',
    monthly: 'Forventet månedligt indkøb', bank: 'Pengeinstitut', reg: 'Reg.nr.', acc: 'Kontonr.',
    cpr: 'CPR', addr: 'Adresse', gln: 'EAN/GLN', vat: 'CVR/VAT', form: 'Virksomhedsform', web: 'Website',
  },
  en: {
    title: 'Customer onboarding — signed', company: 'Company', contacts: 'Contacts',
    docmails: 'Document recipients', ls: 'Direct Debit mandate', guar: 'Personal guarantee',
    terms: 'Terms of sale and delivery', gdpr: 'Processing of personal data (GDPR)',
    consent: 'Consent & signature', signer: 'Authorised signatory', guarantor: 'Guarantor',
    yes: 'Yes', no: 'No', place: 'Place', date: 'Date', marketing: 'Marketing (mail/SMS)',
    monthly: 'Expected monthly purchase', bank: 'Bank', reg: 'Reg. no.', acc: 'Account no.',
    cpr: 'CPR', addr: 'Address', gln: 'EAN/GLN', vat: 'Company reg./VAT', form: 'Company type', web: 'Website',
  },
}

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function row(label: string, val: any): string {
  if (val === undefined || val === null || val === '') return ''
  return `<tr><td class="k">${esc(label)}</td><td>${esc(val)}</td></tr>`
}

export async function buildOnboardingPdf(d: OnboardingPdfData): Promise<Buffer> {
  const t = T[d.lang]
  const legal = LEGAL[d.lang]
  const isLs = d.variant === 'ls'

  const contactsRows = (d.contacts || [])
    .filter(c => c && (c.name || c.email || c.mobile))
    .map((c, i) => `<tr><td class="k">${i + 1}</td><td>${esc(c.name)} · ${esc(c.mobile)} · ${esc(c.email)}</td></tr>`)
    .join('')

  const docRows = (d.docEmails || [])
    .filter(x => x.emails && x.emails.filter(Boolean).length)
    .map(x => `<tr><td class="k">${esc(x.type)}</td><td>${esc(x.emails.filter(Boolean).join(', '))}</td></tr>`)
    .join('')

  const lsBlock = isLs ? `
    <h2>${t.ls}</h2>
    <div class="legal">${legal.ls}</div>
    <table class="kv">
      ${row(t.bank, d.lsBankName)}${row(t.reg, d.lsRegNo)}${row(t.acc, d.lsAccountNo)}
    </table>` : ''

  const guarBlock = (d.guaranty && d.guarantorName) ? `
    <h2>${t.guar}</h2>
    <div class="legal">${legal.guar}</div>
    <table class="kv">
      ${row(t.guarantor, d.guarantorName)}${row(t.cpr, d.guarantorCpr)}${row(t.addr, d.guarantorAddress)}
    </table>
    <div class="sigbox">
      <div class="sigcap">${t.guarantor}</div>
      ${d.sig2 ? `<img src="${d.sig2}" class="sig">` : ''}
      <div class="sigline">${esc(d.guarantorName || '')}</div>
    </div>` : ''

  const html = `<!DOCTYPE html><html lang="${d.lang}"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5pt; color: #17252c; margin: 0; }
  h1 { font-size: 19pt; color: #0b3d5c; margin: 0 0 2mm; }
  h2 { font-size: 12.5pt; color: #0b3d5c; border-bottom: 2px solid #0b3d5c; padding-bottom: 1mm; margin: 7mm 0 2mm; }
  .meta { color: #566; font-size: 9pt; margin-bottom: 4mm; }
  table.kv { width: 100%; border-collapse: collapse; margin: 1mm 0 2mm; }
  table.kv td { border-bottom: 1px solid #e2e9ec; padding: 1.6mm 2mm; vertical-align: top; font-size: 10pt; }
  table.kv td.k { width: 40%; color: #4a5b64; font-weight: 600; background: #f5f8f9; }
  .legal { font-size: 8.6pt; color: #3a4a52; line-height: 1.5; background: #f7fafb; border: 1px solid #e2e9ec; border-radius: 4px; padding: 2mm 3mm; }
  .legal h4 { color: #17252c; font-size: 9pt; margin: 2mm 0 1mm; }
  .legal p { margin: 0 0 1.5mm; }
  .sigbox { margin-top: 4mm; }
  .sigcap { font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: #0f6c78; font-weight: 700; margin-bottom: 1mm; }
  .sig { height: 22mm; max-width: 80mm; border-bottom: 1px solid #333; }
  .sigline { border-top: 1px solid #333; margin-top: 1mm; padding-top: 1mm; width: 80mm; font-size: 9pt; }
  .badge { display: inline-block; background: #0b3d5c; color: #fff; font-size: 8pt; padding: 1px 7px; border-radius: 3px; margin-left: 6px; }
</style></head><body>
  <h1>Venmark Fisk A/S <span class="badge">${esc(t.title)}</span></h1>
  <div class="meta">Søndergade 50 · 9850 Hirtshals · CVR 33050151 · ${esc(t.date)}: ${esc(d.signDate || '')}${d.signPlace ? ' · ' + esc(t.place) + ': ' + esc(d.signPlace) : ''}</div>

  <h2>${t.company}</h2>
  <table class="kv">
    ${row('', d.companyName ? `<b>${esc(d.companyName)}</b>` : '')}
    ${row(t.vat, d.vatRegistrationNo)}${row(t.form, d.companyForm)}
    ${row(t.addr, [d.address, [d.postCode, d.city].filter(Boolean).join(' '), d.countryRegionCode].filter(Boolean).join(', '))}
    ${d.eInvoiceEan ? row(t.gln, d.gln) : ''}${row(t.web, d.website)}
  </table>

  <h2>${t.contacts}</h2>
  <table class="kv">${contactsRows || row('', '—')}${row('Tlf/mail', [d.phoneNo, d.email].filter(Boolean).join(' · '))}</table>

  <h2>${t.docmails}</h2>
  <table class="kv">${docRows || row('', '—')}
    ${row(t.monthly, d.expectedMonthlyPurchase)}${row('Prisliste', d.prislisteSprog)}
  </table>

  ${lsBlock}
  ${guarBlock}

  <h2>${t.terms}</h2><div class="legal">${legal.terms}</div>
  <h2>${t.gdpr}</h2><div class="legal">${legal.gdpr}</div>

  <h2>${t.consent}</h2>
  <table class="kv">${row(t.marketing, d.marketingConsent ? t.yes : t.no)}</table>
  <div class="sigbox">
    <div class="sigcap">${t.signer}</div>
    ${d.sig1 ? `<img src="${d.sig1}" class="sig">` : ''}
    <div class="sigline">${esc(d.signerName || d.companyName || '')}</div>
  </div>
</body></html>`

  return renderPdfFromHtml({ html, landscape: false })
}
