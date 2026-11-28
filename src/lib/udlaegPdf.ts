// PDF til Expense720: KVITTERINGEN FØRST (så Expense720 aflæser butik, dato, beløb og moms
// fra den rigtige kvittering), og "Udlægsbilag"-siden SIDST med alt bogholderiet skal bruge.

import { renderPdfFromHtml } from '@/lib/pricelist/render'

export interface UdlaegPdfData {
  bilagId: string
  navn: string
  vendorNo: string
  betaltMed: string          // "Privat udlæg" / "Firmakort: Mastercard Claus"
  bankkonto: string
  dato: string               // yyyy-mm-dd
  butik: string
  butikCvr: string
  beloeb: number
  moms: number
  valuta: string
  konto: string              // "2610 Brændstof" / "Ved ikke — bogholderiet vælger"
  formaal: string
  deltagere: string
  indsendt: string           // dansk tid, fx "28-11-2026 14:32"
  email: string
}

const esc = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const kr = (n: number) => n.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const datoDK = (iso: string) => { const [y, m, d] = iso.split('-'); return d && m && y ? `${d}-${m}-${y}` : iso }

export async function lavUdlaegPdf(data: UdlaegPdfData, billeder: string[]): Promise<Buffer> {
  const raekke = (k: string, v: string) => v ? `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>` : ''
  const sider = billeder.map(src =>
    `<section class="kvit"><img src="${src}" alt="Kvittering"/></section>`).join('')

  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"/><style>
    @page { size: A4; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; }
    .kvit { height: 270mm; display: flex; align-items: center; justify-content: center; page-break-after: always; }
    .kvit img { max-width: 100%; max-height: 270mm; object-fit: contain; }
    .forside h1 { font-size: 22pt; margin: 0 0 4mm; }
    .forside .id { font-size: 14pt; font-weight: bold; margin-bottom: 8mm; }
    table { border-collapse: collapse; width: 100%; font-size: 12pt; }
    th { text-align: left; width: 55mm; padding: 2.5mm 4mm 2.5mm 0; color: #444; font-weight: normal; vertical-align: top; }
    td { padding: 2.5mm 0; font-weight: bold; border-bottom: 1px solid #ddd; }
    .note { margin-top: 10mm; font-size: 9pt; color: #666; }
  </style></head><body>
    ${sider}
    <section class="forside">
      <h1>Udlægsbilag — Venmark Fisk A/S</h1>
      <div class="id">Bilags-ID: ${esc(data.bilagId)}</div>
      <table>
        ${raekke('Medarbejder', data.navn)}
        ${raekke('Kreditornr.', data.vendorNo)}
        ${raekke('Betalt med', data.betaltMed)}
        ${raekke('Bankkonto (kort)', data.bankkonto)}
        ${raekke('Købsdato', datoDK(data.dato))}
        ${raekke('Butik/leverandør', data.butik)}
        ${raekke('Butikkens CVR', data.butikCvr)}
        ${raekke('Beløb inkl. moms', `${kr(data.beloeb)} ${data.valuta}`)}
        ${raekke('Heraf moms', data.moms ? `${kr(data.moms)} ${data.valuta}` : '')}
        ${raekke('Konto', data.konto)}
        ${raekke('Formål', data.formaal)}
        ${raekke('Anledning/deltagere', data.deltagere)}
        ${raekke('Indsendt', `${data.indsendt} af ${data.email}`)}
      </table>
      <p class="note">Indsendt fra Venmarks medarbejder-app. Kvitteringen er vedhæftet på de foregående sider.</p>
    </section>
  </body></html>`

  return renderPdfFromHtml({
    html,
    landscape: false,
    footerTemplate: `<div style="font-size:7pt;color:#888;width:100%;text-align:center;">
      ${esc(data.bilagId)} — Side <span class="pageNumber"></span> af <span class="totalPages"></span></div>`,
  })
}
