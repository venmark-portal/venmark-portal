import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getStandingOrderLines } from '@/lib/businesscentral'
import { RefreshCw } from 'lucide-react'

export const dynamic = 'force-dynamic'

const DAYS = ['Man', 'Tir', 'Ons', 'Tor', 'Fre'] as const

export default async function FastPage() {
  const session    = await getServerSession(authOptions)
  const customerNo = (session?.user as any)?.bcCustomerNumber as string ?? ''

  const lines = await getStandingOrderLines(customerNo).catch(() => [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Faste ordrer</h1>
        <p className="mt-1 text-sm text-gray-500">
          Dine faste ugentlige ordrelinjer — styres af Venmark
        </p>
      </div>

      {lines.length === 0 ? (
        <div className="rounded-2xl bg-white ring-1 ring-gray-200 px-6 py-12 text-center">
          <RefreshCw size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">Ingen faste ordrelinjer opsat endnu</p>
          <p className="text-xs text-gray-400 mt-1">Kontakt Venmark for at få oprettet faste ordrelinjer</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white ring-1 ring-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3 text-left">Vare</th>
                  <th className="px-3 py-3 text-left">Enhed</th>
                  {DAYS.map(d => (
                    <th key={d} className="px-3 py-3 text-center w-14">{d}</th>
                  ))}
                  <th className="px-4 py-3 text-left">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((l, i) => {
                  const qtys = [l.qtyMonday, l.qtyTuesday, l.qtyWednesday, l.qtyThursday, l.qtyFriday]
                  return (
                    <tr key={i} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">{l.description || l.itemNo}</span>
                        <span className="block text-[11px] text-gray-400 font-mono">{l.itemNo}</span>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{l.unitOfMeasureCode || '—'}</td>
                      {qtys.map((q, di) => (
                        <td key={di} className="px-3 py-3 text-center">
                          {q > 0
                            ? <span className="font-semibold text-gray-800">{q}</span>
                            : <span className="text-gray-200">—</span>
                          }
                        </td>
                      ))}
                      <td className="px-4 py-3 text-gray-500 text-xs">{l.standingNote || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
