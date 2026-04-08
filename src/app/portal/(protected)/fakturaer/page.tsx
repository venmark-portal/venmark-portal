import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getPostedInvoices } from '@/lib/businesscentral'
import { FileText, AlertCircle, Printer } from 'lucide-react'
import Link from 'next/link'
import KontoudtogWidget from '@/components/portal/KontoudtogWidget'

export const dynamic = 'force-dynamic'

export default async function FakturaerPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')

  const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''

  // Hent fakturaer fra seneste 365 dage
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const fromDate = oneYearAgo.toISOString().split('T')[0]

  const invoices = await getPostedInvoices(customerNo, fromDate)

  const fmt = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })

  // Seneste 30 dages total
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const recent = invoices.filter(inv => new Date(inv.postingDate) >= thirtyDaysAgo)
  const recentTotal = recent.reduce((s, inv) => s + inv.totalAmountIncludingTax, 0)

  // Udestående saldo
  const outstanding = invoices.filter(inv => inv.remainingAmount > 0)
  const outstandingTotal = outstanding.reduce((s, inv) => s + inv.remainingAmount, 0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Fakturaer</h1>
        <p className="mt-1 text-sm text-gray-500">Seneste 12 måneder</p>
      </div>

      {/* Kontoudtog som Excel — øverst */}
      {invoices.length > 0 && <KontoudtogWidget />}

      {/* KPI-kort */}
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

      {invoices.length === 0 ? (
        <div className="rounded-xl bg-white px-6 py-16 text-center text-gray-500 ring-1 ring-gray-200">
          <FileText size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium">Ingen fakturaer fundet</p>
          <p className="mt-1 text-sm text-gray-400">Fakturaer fra de seneste 12 måneder vises her</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
          <div className="divide-y divide-gray-100">
            {invoices.map(inv => {
              const isRecent = new Date(inv.postingDate) >= thirtyDaysAgo
              const hasBalance = inv.remainingAmount > 0
              const dueDate = inv.dueDate ? new Date(inv.dueDate) : null
              const isOverdue = dueDate && !inv.closed && dueDate < new Date()
              return (
                <div key={inv.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                  {/* Klikbart område → detalje */}
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
                  {/* Beløb + PDF-knap */}
                  <div className="shrink-0 flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm font-semibold text-gray-900">{fmt.format(inv.totalAmountIncludingTax)}</div>
                      {hasBalance && (
                        <div className="text-xs text-amber-600">Rest: {fmt.format(inv.remainingAmount)}</div>
                      )}
                    </div>
                    {/* PDF-print knap */}
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
      )}

    </div>
  )
}
