'use client'

import { Fragment, useState } from 'react'
import { approveOrders } from '@/app/admin/(protected)/actions'

interface OrderLine {
  id:           string
  bcItemNumber: string
  itemName:     string
  quantity:     number
  uom:          string
  unitPrice:    number
  status:       string
}

interface Order {
  id:              string
  bcOrderNumber:   string | null
  bcOrderId:       string | null
  type:            string
  status:          string
  deliveryDate:    string
  deadline:        string
  submittedAt:     string | null
  approvedAt:      string | null
  notes:           string | null
  poNumber:        string | null
  driverNote:      string | null
  orderedByName:   string | null
  orderedByEmail:  string | null
  customer:        { id: string; name: string; bcCustomerNumber: string }
  lines:           OrderLine[]
}

type StatusKey = 'SUBMITTED' | 'APPROVED' | 'SENT_TO_BC' | 'CONFIRMED' | 'REJECTED'
type FilterKey = 'ALL' | StatusKey

const STATUS_META: Record<StatusKey, { label: string; cls: string }> = {
  SUBMITTED:  { label: 'Afventer',      cls: 'bg-amber-100 text-amber-800' },
  APPROVED:   { label: 'BC fejlede',    cls: 'bg-red-100 text-red-800' },
  SENT_TO_BC: { label: 'Sendt til BC',  cls: 'bg-green-100 text-green-800' },
  CONFIRMED:  { label: 'Bekræftet',     cls: 'bg-blue-100 text-blue-800' },
  REJECTED:   { label: 'Afvist',        cls: 'bg-gray-100 text-gray-700' },
}

function fmtMoney(n: number): string {
  return n.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string | null, withTime = false): string {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleString('da-DK', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' })
}

function lineTotal(l: OrderLine): number {
  return l.quantity * l.unitPrice
}

function orderTotal(o: Order): number {
  return o.lines.reduce((acc, l) => acc + lineTotal(l), 0)
}

function isActionable(status: string): boolean {
  return status === 'SUBMITTED' || status === 'APPROVED'
}

export default function OrderManager({ initialOrders }: { initialOrders: Order[] }) {
  const [orders, setOrders]     = useState<Order[]>(initialOrders)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy]         = useState<Set<string>>(new Set())
  const [feedback, setFeedback] = useState<{ targetId: string; message: string; ok: boolean } | null>(null)
  const [filter, setFilter]     = useState<FilterKey>('ALL')

  const FILTERS: FilterKey[] = ['ALL', 'SUBMITTED', 'APPROVED', 'SENT_TO_BC', 'REJECTED']
  const visible = filter === 'ALL' ? orders : orders.filter(o => o.status === filter)
  const countFor = (f: FilterKey) => f === 'ALL' ? orders.length : orders.filter(o => o.status === f).length

  const selectedActionable = Array.from(selected).filter(id => {
    const o = orders.find(x => x.id === id)
    return o && isActionable(o.status)
  })

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function approve(ids: string[]) {
    const targets = ids.filter(id => {
      const o = orders.find(x => x.id === id)
      return o && isActionable(o.status)
    })
    if (targets.length === 0) return

    setBusy(prev => { const n = new Set(prev); targets.forEach(t => n.add(t)); return n })
    setFeedback(null)

    try {
      const { results } = await approveOrders(targets)

      setOrders(prev => prev.map(o => {
        const r = results.find(r => r.id === o.id)
        if (!r) return o
        if (r.bcOrderNumber) {
          return { ...o, status: 'SENT_TO_BC', bcOrderNumber: r.bcOrderNumber, approvedAt: new Date().toISOString() }
        }
        if (r.bcError) {
          return { ...o, status: 'APPROVED', approvedAt: new Date().toISOString() }
        }
        return o
      }))

      const ok       = results.filter(r => r.bcOrderNumber).length
      const lineErrs = results.filter(r => r.lineErrors && r.lineErrors.length > 0).length
      const failed   = results.filter(r => r.bcError).length
      const lastFail = results.find(r => r.bcError)

      let msg = ''
      if (ok > 0)       msg += `${ok} ordre(r) sendt til BC. `
      if (lineErrs > 0) msg += `${lineErrs} havde linjefejl. `
      if (failed > 0)   msg += `${failed} fejlede: ${lastFail?.bcError ?? ''}`

      const tail = targets[targets.length - 1]
      setFeedback({ targetId: tail, message: msg.trim() || 'Færdig.', ok: failed === 0 })
      setSelected(new Set())
    } catch (e: any) {
      setFeedback({ targetId: targets[0], message: `Fejl: ${e?.message ?? 'ukendt'}`, ok: false })
    } finally {
      setBusy(prev => { const n = new Set(prev); targets.forEach(t => n.delete(t)); return n })
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(f => {
          const active = filter === f
          const label = f === 'ALL' ? 'Alle' : STATUS_META[f as StatusKey].label
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1.5 text-sm ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {label} <span className="ml-1 text-xs opacity-70">({countFor(f)})</span>
            </button>
          )
        })}
        {selectedActionable.length > 0 && (
          <button
            onClick={() => approve(selectedActionable)}
            disabled={busy.size > 0}
            className="ml-auto rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
          >
            Godkend {selectedActionable.length} valgte
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-10 px-3 py-2"></th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Bestilt</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Kunde</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Levering</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">Linjer</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">Total (kr)</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Status</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">BC-nr.</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">Handling</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">Ingen ordrer matcher filteret</td></tr>
              )}
              {visible.map(o => {
                const isOpen   = expanded.has(o.id)
                const isBusy   = busy.has(o.id)
                const showFb   = feedback?.targetId === o.id
                const action   = isActionable(o.status)
                const total    = orderTotal(o)
                const meta     = STATUS_META[o.status as StatusKey] ?? { label: o.status, cls: 'bg-gray-100 text-gray-700' }
                return (
                  <Fragment key={o.id}>
                    <tr className={`hover:bg-gray-50 ${action ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-3 py-2">
                        {action && (
                          <input
                            type="checkbox"
                            checked={selected.has(o.id)}
                            onChange={() => toggleSelect(o.id)}
                            disabled={isBusy}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fmtDate(o.submittedAt, true)}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{o.customer.name}</div>
                        <div className="text-xs text-gray-500">{o.customer.bcCustomerNumber}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fmtDate(o.deliveryDate)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{o.lines.length}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">{fmtMoney(total)}</td>
                      <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span></td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">{o.bcOrderNumber ?? '—'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => toggleExpand(o.id)}
                          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
                        >
                          {isOpen ? 'Skjul' : 'Vis'}
                        </button>
                        {action && (
                          <button
                            onClick={() => approve([o.id])}
                            disabled={isBusy}
                            className="ml-2 rounded bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                          >
                            {isBusy ? '...' : 'Godkend'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} className="bg-gray-50 px-6 py-4">
                          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600 md:grid-cols-4">
                            <div><span className="font-medium">Ordre-ID:</span> <span className="font-mono">{o.id}</span></div>
                            <div><span className="font-medium">Deadline:</span> {fmtDate(o.deadline, true)}</div>
                            <div><span className="font-medium">PO-nr.:</span> {o.poNumber ?? '—'}</div>
                            <div><span className="font-medium">Bestilt af:</span> {o.orderedByName ?? '—'}{o.orderedByEmail ? ` (${o.orderedByEmail})` : ''}</div>
                            {o.notes && (
                              <div className="col-span-2 md:col-span-4">
                                <span className="font-medium">Besked til Venmark:</span> <span className="italic">{o.notes}</span>
                              </div>
                            )}
                            {o.driverNote && (
                              <div className="col-span-2 md:col-span-4">
                                <span className="font-medium">Besked til chauffør:</span> <span className="italic">{o.driverNote}</span>
                              </div>
                            )}
                          </div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-gray-500 border-b border-gray-200">
                                <th className="py-1.5">Varenr.</th>
                                <th className="py-1.5">Beskrivelse</th>
                                <th className="py-1.5 text-right">Antal</th>
                                <th className="py-1.5">Enhed</th>
                                <th className="py-1.5 text-right">Pris</th>
                                <th className="py-1.5 text-right">Linje (kr)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {o.lines.map(l => (
                                <tr key={l.id}>
                                  <td className="py-1.5 font-mono">{l.bcItemNumber}</td>
                                  <td className="py-1.5">{l.itemName}</td>
                                  <td className="py-1.5 text-right">{l.quantity}</td>
                                  <td className="py-1.5">{l.uom}</td>
                                  <td className="py-1.5 text-right">{fmtMoney(l.unitPrice)}</td>
                                  <td className="py-1.5 text-right">{fmtMoney(lineTotal(l))}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-gray-300 font-medium">
                                <td colSpan={5} className="py-1.5 text-right">Total</td>
                                <td className="py-1.5 text-right">{fmtMoney(total)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </td>
                      </tr>
                    )}
                    {showFb && feedback && (
                      <tr>
                        <td colSpan={9} className={`px-3 py-2 text-xs ${feedback.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                          {feedback.message}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
