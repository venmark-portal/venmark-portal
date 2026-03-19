import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getPostedInvoices, getPostedInvoiceLines } from '@/lib/businesscentral'
import { ArrowLeft, AlertCircle, CheckCircle2, Printer } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function FakturaDetailPage({ params }: { params: { number: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')

  const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''

  // Hent alle fakturaer og find den rigtige
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const fromDate = oneYearAgo.toISOString().split('T')[0]

  const invoices = await getPostedInvoices(customerNo, fromDate)
  const invoice = invoices.find(inv => inv.number === params.number)

  if (!invoice) redirect('/portal/fakturaer')

  // Hent fakturalinjer
  const lines = await getPostedInvoiceLines(invoice.number)

  const fmt = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })
  const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null
  const isOverdue = dueDate && !invoice.closed && dueDate < new Date()
  const hasBalance = invoice.remainingAmount > 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/portal/fakturaer" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 font-mono">{invoice.number}</h1>
          <p className="text-xs text-gray-500">
            Bogført {new Date(invoice.postingDate).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        {/* Print/PDF knap */}
        <a
          href={`/portal/fakturaer/${invoice.number}/print?print=1`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Printer size={15} />
          PDF
        </a>
      </div>

      {/* Status-kort */}
      <div className={`rounded-xl p-4 ring-1 ${isOverdue ? 'bg-red-50 ring-red-100' : hasBalance ? 'bg-amber-50 ring-amber-100' : 'bg-green-50 ring-green-100'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              {invoice.closed || !hasBalance ? (
                <CheckCircle2 size={16} className="text-green-600" />
              ) : (
                <AlertCircle size={16} className={isOverdue ? 'text-red-600' : 'text-amber-600'} />
              )}
              <span className={`text-sm font-semibold ${isOverdue ? 'text-red-700' : hasBalance ? 'text-amber-700' : 'text-green-700'}`}>
                {invoice.closed || !hasBalance ? 'Betalt' : isOverdue ? 'Forfaldent' : 'Udestående'}
              </span>
            </div>
            {dueDate && hasBalance && (
              <p className="text-xs text-gray-500 mt-1">
                Forfaldsdato: {dueDate.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
            {invoice.paymentTermsCode && (
              <p className="text-xs text-gray-400 mt-0.5">Betalingsbetingelse: {invoice.paymentTermsCode}</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900">{fmt.format(invoice.totalAmountIncludingTax)}</div>
            <div className="text-xs text-gray-500">inkl. moms</div>
            {hasBalance && (
              <div className={`text-sm font-semibold mt-1 ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>
                Rest: {fmt.format(invoice.remainingAmount)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fakturalinjer */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Fakturalinjer</p>
        {lines.length === 0 ? (
          <div className="rounded-xl bg-white ring-1 ring-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            Ingen linjer fundet
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
            <div className="divide-y divide-gray-100">
              {lines.filter(l => l.type !== '' && l.description).map((line, idx) => (
                <div key={`${line.documentNumber}-${line.lineNumber}-${idx}`} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {line.itemNumber && (
                        <span className="font-mono text-xs text-gray-400 mr-2">{line.itemNumber}</span>
                      )}
                      <span className="text-sm text-gray-800">{line.description}</span>
                      <div className="mt-0.5 text-xs text-gray-400">
                        {line.quantity} {line.unitOfMeasureCode}
                        {line.unitPrice > 0 && ` · ${fmt.format(line.unitPrice)}/stk`}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-gray-900">{fmt.format(line.lineAmount)}</div>
                      {line.amountIncludingVAT !== line.lineAmount && (
                        <div className="text-xs text-gray-400">inkl. {fmt.format(line.amountIncludingVAT)}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {/* Totaler */}
            <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Beløb ekskl. moms</span>
                <span className="font-medium text-gray-900">{fmt.format(invoice.totalAmountExcludingTax)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <span className="text-gray-700">Beløb inkl. moms</span>
                <span className="text-gray-900">{fmt.format(invoice.totalAmountIncludingTax)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-gray-400">
        Ønsker du kopi af faktura?{' '}
        <a href={`mailto:ordre@venmark.dk?subject=Faktura ${invoice.number}`} className="text-blue-600 hover:underline">
          Kontakt os
        </a>
      </p>
    </div>
  )
}
