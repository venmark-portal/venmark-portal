import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getPostedInvoices, getPostedCreditMemos } from '@/lib/businesscentral'
import { FileText, AlertCircle, Printer } from 'lucide-react'
import Link from 'next/link'
import KontoudtogWidget from '@/components/portal/KontoudtogWidget'

export const dynamic = 'force-dynamic'

export default async function FakturaerPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')

  const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''

  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const fromDate = oneYearAgo.toISOString().split('T')[0]

  const [invoices, creditMemos] = await Promise.all([
    getPostedInvoices(customerNo, fromDate),
    getPostedCreditMemos(customerNo, fromDate),
  ])

  const fmt = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const recent = invoices.filter(inv => new Date(inv.postingDate) >= thirtyDaysAgo)
  const recentTotal = recent.reduce((s, inv) => s + inv.totalAmountIncludingTax, 0)

  const outstanding = invoices.filter(inv => inv.remainingAmount > 0)
  const outstandingTotal = outstanding.reduce((s, inv) => s + inv.remainingAmount, 0)

  const hasDocuments = invoices.length > 0 || creditMemos.length > 0

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Fakturaer</h1>
        <p className="mt-1 text-sm text-gray-500">Seneste 12 måneder</p>
      </div>

      {hasDocuments && <KontoudtogWidget />}

      {invoices.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-blue-50 p-4 ring-1 ring-blue-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 mb-1">Seneste 30 dage</p>
            <div className="text-xl font-bold text-blue-900">{fmt.format(recentTotal)}</div>
            <div className="text-xs text-blue-600 mt-0.5">{recent.length} {recent.length === 1 ? 'faktura' : 'fakturaer'}</div>
          </div>
          <div className={`rounded-xl p-4 ring-1 ${outstandingTotal > 0 ? 'bg-amber-50 ring-amber-100' : 'bg-green-50 ring-green-100'}`}>
            <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${outstandingTotal > 0 ? 'text-amber-600' : 'text-green-600'}`}>Udestående</p>
            <div className={`text-xl font-bold ${outstandingTotal > 0 ? 'text-amber-900' : 'text-green-700'}`}>{fmt.format(outstandingTotal)}</div>
            <div className={`text-xs mt-0.5 ${outstandingTotal > 0 ? 'text-amber-600' : 'text-green-600'}`}>{outstanding.length} {outstanding.length === 1 ? 'faktura' : 'fakturaer'}</div>
          </div>
        </div>
      )}

      {!hasDocuments ? (
        <div className="rounded-xl bg-white px-6 py-16 text-center text-gray-500 ring-1 ring-gray-200">
          <FileText size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium">Ingen dokumenter fundet</p>
          <p className="mt-1 text-sm text-gray-400">Fakturaer og kreditnotaer fra de seneste 12 måneder vises her</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Fakturaer */}
          {invoices.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Fakturaer</p>
              <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
                <div className="divide-y divide-gray-100">
                  {invoices.map(inv => {
                    const isRecent = new Date(inv.postingDate) >= thirtyDaysAgo
                    const hasBalance = inv.remainingAmount > 0
                    const dueDate = inv.dueDate ? new Date(inv.dueDate) : null
                    const isOverdue = dueDate && !inv.closed && dueDate < new Date()
                    return (
                      <div key={inv.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                        <Link href={`/portal/fakturaer/${inv.number}`} className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-gray-900">{inv.number}</span>
                            {isRecent && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Ny</span>
                            )}
                            {isOverdue && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                <AlertCircle size={10} /> Forfaldent
                              </span>
                            )}
                            {hasBalance && !isOverdue && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                                <AlertCircle size={10} /> Udestående
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-gray-500">
                            {new Date(inv.postingDate).toLocaleDateString('da-DK', {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })}
                            {dueDate && ` · Forfald: ${dueDate.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })}`}
                          </div>
                        </Link>
                        <div className="shrink-0 flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-sm font-semibold text-gray-900">{fmt.format(inv.totalAmountIncludingTax)}</div>
                            {hasBalance && (
                              <div className="text-xs text-amber-600">Rest: {fmt.format(inv.remainingAmount)}</div>
                            )}
                          </div>
                          <a
                            href={`/api/portal/fakturaer/${inv.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Download PDF"
                            className="rounded-lg p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            <Printer size={16} />
                          </a>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Kreditnotaer */}
          {creditMemos.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Kreditnotaer</p>
              <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
                <div className="divide-y divide-gray-100">
                  {creditMemos.map(cm => {
                    const isRecent = new Date(cm.postingDate) >= thirtyDaysAgo
                    return (
                      <div key={cm.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                        <Link href={`/portal/kreditnotaer/${cm.number}`} className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-gray-900">{cm.number}</span>
                            {isRecent && (
                              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">Ny</span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-gray-500">
                            {new Date(cm.postingDate).toLocaleDateString('da-DK', {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })}
                            {cm.appliesToDocNo && ` · Vedr. faktura ${cm.appliesToDocNo}`}
                          </div>
                        </Link>
                        <div className="shrink-0 flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-sm font-semibold text-purple-700">−{fmt.format(cm.totalAmountIncludingTax)}</div>
                          </div>
                          <a
                            href={`/api/portal/kreditnotaer/${cm.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Download PDF"
                            className="rounded-lg p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-colors"
                          >
                            <Printer size={16} />
                          </a>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
