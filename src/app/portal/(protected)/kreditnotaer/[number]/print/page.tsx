import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getPostedCreditMemos, getPostedCreditMemoLines } from '@/lib/businesscentral'
import PrintButtons from '../../../../../fakturaer/[number]/print/PrintButtons'

export const dynamic = 'force-dynamic'

export default async function KreditnotaPrintPage({ params }: { params: { number: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')

  const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''

  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const creditMemos = await getPostedCreditMemos(customerNo, oneYearAgo.toISOString().split('T')[0])
  const creditMemo  = creditMemos.find(cm => cm.number === params.number)
  if (!creditMemo) redirect('/portal/fakturaer')

  const lines = await getPostedCreditMemoLines(creditMemo.number)
  const fmt   = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })
  const itemLines = lines.filter(l => l.type !== '' && l.description)

  return (
    <html lang="da">
      <head>
        <meta charSet="utf-8" />
        <title>Kreditnota {creditMemo.number} — Venmark Fisk</title>
        <style dangerouslySetInnerHTML={{ __html: `
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: #fff; }
          .page { max-width: 800px; margin: 0 auto; padding: 32px; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
          .logo { font-size: 22px; font-weight: bold; color: #1e40af; }
          .logo-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
          .doc-title { text-align: right; }
          .doc-title h1 { font-size: 20px; font-weight: bold; color: #7c3aed; }
          .doc-title .num { font-family: monospace; font-size: 16px; color: #374151; }
          .addresses { display: flex; gap: 40px; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #e5e7eb; }
          .addr-block { flex: 1; }
          .addr-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; margin-bottom: 4px; }
          .addr-name { font-weight: bold; font-size: 13px; margin-bottom: 2px; }
          .addr-line { color: #374151; line-height: 1.5; }
          .meta { display: flex; gap: 24px; margin-bottom: 28px; }
          .meta-item { flex: 1; }
          .meta-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; margin-bottom: 2px; }
          .meta-value { font-weight: 600; color: #111; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          thead tr { background: #f3f4f6; }
          th { padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; font-weight: 600; }
          th.right, td.right { text-align: right; }
          td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; color: #374151; }
          tr:last-child td { border-bottom: none; }
          .item-no { font-family: monospace; font-size: 10px; color: #9ca3af; }
          .totals { margin-left: auto; width: 260px; margin-bottom: 32px; }
          .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; }
          .totals-row.bold { font-weight: bold; font-size: 14px; border-top: 2px solid #7c3aed; padding-top: 8px; margin-top: 4px; color: #7c3aed; }
          .totals-row .label { color: #6b7280; }
          .footer { border-top: 1px solid #e5e7eb; padding-top: 16px; color: #9ca3af; font-size: 10px; display: flex; justify-content: space-between; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
            .page { padding: 16px; }
          }
        `}} />
        <script dangerouslySetInnerHTML={{ __html: `
          window.addEventListener('load', function() {
            if (window.location.search.includes('print=1')) {
              setTimeout(function() { window.print(); }, 400);
            }
          });
        `}} />
      </head>
      <body>
        <div className="page">
          <div className="no-print">
            <PrintButtons />
          </div>

          <div className="header">
            <div>
              <div className="logo">Venmark Fisk</div>
              <div className="logo-sub">Søndergade · 9850 Hirtshals · CVR: xxxxxxxxxx</div>
              <div className="logo-sub">ordre@venmark.dk · venmark.dk</div>
            </div>
            <div className="doc-title">
              <h1>KREDITNOTA</h1>
              <div className="num">{creditMemo.number}</div>
            </div>
          </div>

          <div className="addresses">
            <div className="addr-block">
              <div className="addr-label">Krediteret til</div>
              <div className="addr-name">{creditMemo.customerName}</div>
              <div className="addr-line">Debitor nr. {creditMemo.customerNumber}</div>
            </div>
            <div className="addr-block">
              <div className="addr-label">Fra</div>
              <div className="addr-name">Venmark Fisk AS</div>
              <div className="addr-line">Søndergade, 9850 Hirtshals</div>
            </div>
          </div>

          <div className="meta">
            <div className="meta-item">
              <div className="meta-label">Dato</div>
              <div className="meta-value">
                {new Date(creditMemo.postingDate).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
            {creditMemo.appliesToDocNo && (
              <div className="meta-item">
                <div className="meta-label">Vedr. faktura</div>
                <div className="meta-value" style={{ fontFamily: 'monospace' }}>{creditMemo.appliesToDocNo}</div>
              </div>
            )}
            {creditMemo.paymentTermsCode && (
              <div className="meta-item">
                <div className="meta-label">Betalingsbetingelse</div>
                <div className="meta-value">{creditMemo.paymentTermsCode}</div>
              </div>
            )}
          </div>

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

          <div className="totals">
            <div className="totals-row">
              <span className="label">Beløb ekskl. moms</span>
              <span>{fmt.format(creditMemo.totalAmountExcludingTax)}</span>
            </div>
            <div className="totals-row">
              <span className="label">Moms (25%)</span>
              <span>{fmt.format(creditMemo.totalAmountIncludingTax - creditMemo.totalAmountExcludingTax)}</span>
            </div>
            <div className="totals-row bold">
              <span>Total inkl. moms</span>
              <span>−{fmt.format(creditMemo.totalAmountIncludingTax)}</span>
            </div>
          </div>

          <div className="footer">
            <span>Venmark Fisk AS · Søndergade · 9850 Hirtshals</span>
            <span>Kreditnota {creditMemo.number} · {new Date(creditMemo.postingDate).toLocaleDateString('da-DK')}</span>
          </div>
        </div>
      </body>
    </html>
  )
}
