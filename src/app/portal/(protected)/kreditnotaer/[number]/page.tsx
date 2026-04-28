import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getPostedCreditMemos, getPostedCreditMemoLines } from '@/lib/businesscentral'
import { ArrowLeft, Printer } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function KreditnotaDetailPage({ params }: { params: { number: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')

  const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''

  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const fromDate = oneYearAgo.toISOString().split('T')[0]

  const creditMemos = await getPostedCreditMemos(customerNo, fromDate)
  const creditMemo  = creditMemos.find(cm => cm.number === params.number)

  if (!creditMemo) redirect('/portal/fakturaer')

  const lines = await getPostedCreditMemoLines(creditMemo.number)
  const fmt = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/portal/fakturaer" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 font-mono">{creditMemo.number}</h1>
          <p className="text-xs text-gray-500">
            Kreditnota · bogført {new Date(creditMemo.postingDate).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <a
          href={`/api/portal/kreditnotaer/${creditMemo.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700 transition-colors"
        >
          <Printer size={15} />
          PDF
        </a>
      </div>

      {/* Oplysnings-kort */}
      <div className="rounded-xl bg-purple-50 p-4 ring-1 ring-purple-100">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-purple-700">Kreditnota</p>
            {creditMemo.appliesToDocNo && (
              <p className="text-xs text-gray-500 mt-1">
                Vedr. faktura: <span className="font-mono">{creditMemo.appliesToDocNo}</span>
              </p>
            )}
            {creditMemo.paymentTermsCode && (
              <p className="text-xs text-gray-400 mt-0.5">Betalingsbetingelse: {creditMemo.paymentTermsCode}</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-purple-700">−{fmt.format(creditMemo.totalAmountIncludingTax)}</div>
            <div className="text-xs text-gray-500">inkl. moms</div>
          </div>
        </div>
      </div>

      {/* Linjer */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Linjer</p>
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
            <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Beløb ekskl. moms</span>
                <span className="font-medium text-gray-900">{fmt.format(creditMemo.totalAmountExcludingTax)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <span className="text-gray-700">Beløb inkl. moms</span>
                <span className="text-purple-700">−{fmt.format(creditMemo.totalAmountIncludingTax)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-gray-400">
        Spørgsmål til kreditnotaen?{' '}
        <a href={`mailto:fisk@venmark.dk?subject=Kreditnota ${creditMemo.number}`} className="text-blue-600 hover:underline">
          Kontakt os
        </a>
      </p>
    </div>
  )
}
