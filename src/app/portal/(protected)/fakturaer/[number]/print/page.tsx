import PrintButtons from './PrintButtons'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getPostedInvoices, getPostedInvoiceLines } from '@/lib/businesscentral'

export const dynamic = 'force-dynamic'

/**
 * Print-venlig faktura-side — åbnes i nyt vindue, auto-udskriver.
 * Brugeren kan gemme som PDF fra browserens print-dialog.
 */
export default async function FakturaPrintPage({ params }: { params: { number: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')

  const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''

  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const invoices = await getPostedInvoices(customerNo, oneYearAgo.toISOString().split('T')[0])
  const invoice  = invoices.find(inv => inv.number === params.number)
  if (!invoice) redirect('/portal/fakturaer')

  const lines = await getPostedInvoiceLines(invoice.number)
  const fmt   = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })
  const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null

  const itemLines = lines.filter(l => l.type !== '' && l.description)

  return (
    <html lang="da">
      <head>
        <meta charSet="utf-8" />
        <title>Faktura {invoice.number} — Venmark Fisk</title>
        <style dangerouslySetInnerHTML={{ __html: `
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: #fff; }
          .page { max-width: 800px; margin: 0 auto; padding: 32px; }

          /* Header */
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
          .logo { font-size: 22px; font-weight: bold; color: #1e40af; }
          .logo-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
          .invoice-title { text-align: right; }
          .invoice-title h1 { font-size: 20px; font-weight: bold; color: #111; }
          .invoice-title .num { font-family: monospace; font-size: 16px; color: #374151; }

          /* Adresse-blok */
          .addresses { display: flex; gap: 40px; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #e5e7eb; }
          .addr-block { flex: 1; }
          .addr-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; margin-bottom: 4px; }
          .addr-name { font-weight: bold; font-size: 13px; margin-bottom: 2px; }
          .addr-line { color: #374151; line-height: 1.5; }

          /* Meta */
          .meta { display: flex; gap: 24px; margin-bottom: 28px; }
          .meta-item { flex: 1; }
          .meta-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; margin-bottom: 2px; }
          .meta-value { font-weight: 600; color: #111; }

          /* Tabel */
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          thead tr { background: #f3f4f6; }
          th { padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; font-weight: 600; }
          th.right, td.right { text-align: right; }
          td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; color: #374151; }
          tr:last-child td { border-bottom: none; }
          .item-no { font-family: monospace; font-size: 10px; color: #9ca3af; }

          /* Totaler */
          .totals { margin-left: auto; width: 260px; margin-bottom: 32px; }
          .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; }
          .totals-row.bold { font-weight: bold; font-size: 14px; border-top: 2px solid #111; padding-top: 8px; margin-top: 4px; }
          .totals-row .label { color: #6b7280; }

          /* Status */
          .status-box { padding: 12px 16px; border-radius: 8px; margin-bottom: 24px; font-size: 11px; }
          .status-paid { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
          .status-due  { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
          .status-late { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }

          /* Footer */
          .footer { border-top: 1px solid #e5e7eb; padding-top: 16px; color: #9ca3af; font-size: 10px; display: flex; justify-content: space-between; }

          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
            .page { padding: 16px; }
          }
        `}} />
        <script dangerouslySetInnerHTML={{ __html: `
          window.addEventListener('load', function() {
            // Auto-print kun hvis siden åbnes med ?print=1
            if (window.location.search.includes('print=1')) {
              setTimeout(function() { window.print(); }, 400);
            }
          });
        `}} />
      </head>
      <body>
        <div className="page">
          {/* Print-knapper (client component) */}
          <div className="no-print">
            <PrintButtons />
          </div>

          {/* Header */}
          <div className="header">
            <div>
              <div className="logo">Venmark Fisk</div>
              <div className="logo-sub">Søndergade · 9850 Hirtshals · CVR: xxxxxxxxxx</div>
              <div className="logo-sub">ordre@venmark.dk · venmark.dk</div>
            </div>
            <div className="invoice-title">
              <h1>FAKTURA</h1>
              <div className="num">{invoice.number}</div>
            </div>
          </div>

          {/* Adresser */}
          <div className="addresses">
            <div className="addr-block">
              <div className="addr-label">Faktureret til</div>
              <div className="addr-name">{invoice.customerName}</div>
              <div className="addr-line">Debitor nr. {invoice.customerNumber}</div>
            </div>
            <div className="addr-block">
              <div className="addr-label">Fra</div>
              <div className="addr-name">Venmark Fisk AS</div>
              <div className="addr-line">Søndergade, 9850 Hirtshals</div>
            </div>
          </div>

          {/* Meta */}
          <div className="meta">
            <div className="meta-item">
              <div className="meta-label">Fakturadato</div>
              <div className="meta-value">
                {new Date(invoice.postingDate).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
            {dueDate && (
              <div className="meta-item">
                <div className="meta-label">Forfaldsdato</div>
                <div className="meta-value">
                  {dueDate.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              </div>
            )}
            {invoice.paymentTermsCode && (
              <div className="meta-item">
                <div className="meta-label">Betalingsbetingelse</div>
                <div className="meta-value">{invoice.paymentTermsCode}</div>
              </div>
            )}
          </div>

          {/* Status */}
          {(() => {
            const isOverdue = dueDate && !invoice.closed && dueDate < new Date()
            const hasBalance = invoice.remainingAmount > 0
            if (invoice.closed || !hasBalance) {
              return <div className="status-box status-paid">✓ Betalt</div>
            } else if (isOverdue) {
              return <div className="status-box status-late">⚠ Forfaldent — udestående: {fmt.format(invoice.remainingAmount)}</div>
            } else {
              return <div className="status-box status-due">Udestående: {fmt.format(invoice.remainingAmount)}</div>
            }
          })()}

          {/* Fakturalinjer */}
          <table>
            <thead>
              <tr>
                <th>Varenr.</th>
                <th>Beskrivelse</th>
                <th className="right">Antal</th>
                <th>Enhed</th>
                <th className="right">Enhedspris</th>
                <th className="right">Beløb</th>
              </tr>
            </thead>
            <tbody>
              {itemLines.map((line, idx) => (
                <tr key={idx}>
                  <td><span className="item-no">{line.itemNumber || '—'}</span></td>
                  <td>{line.description}</td>
                  <td className="right">{line.quantity}</td>
                  <td>{line.unitOfMeasureCode}</td>
                  <td className="right">{line.unitPrice > 0 ? fmt.format(line.unitPrice) : '—'}</td>
                  <td className="right">{fmt.format(line.lineAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totaler */}
          <div className="totals">
            <div className="totals-row">
              <span className="label">Beløb ekskl. moms</span>
              <span>{fmt.format(invoice.totalAmountExcludingTax)}</span>
            </div>
            <div className="totals-row">
              <span className="label">Moms (25%)</span>
              <span>{fmt.format(invoice.totalAmountIncludingTax - invoice.totalAmountExcludingTax)}</span>
            </div>
            <div className="totals-row bold">
              <span>Total inkl. moms</span>
              <span>{fmt.format(invoice.totalAmountIncludingTax)}</span>
            </div>
          </div>

          {/* Footer */}
          <div className="footer">
            <span>Venmark Fisk AS · Søndergade · 9850 Hirtshals</span>
            <span>Faktura {invoice.number} · {new Date(invoice.postingDate).toLocaleDateString('da-DK')}</span>
          </div>
        </div>
      </body>
    </html>
  )
}
