'use client'

import { useState, useTransition } from 'react'
import { approveOrders, rejectOrders } from '@/app/admin/(protected)/actions'
import type { ApproveResult } from '@/app/admin/(protected)/actions'
import { CheckCircle2, XCircle, ChevronDown, ChevronUp, AlertTriangle, Loader2 } from 'lucide-react'

type OrderLine = {
  id:          string
  bcItemNumber: string
  itemName:    string
  quantity:    number
  uom:         string
  unitPrice:   number
  status:      string
}

type Order = {
  id:           string
  bcOrderNumber: string | null
  deliveryDate: Date
  notes:        string | null
  customer:     { id: string; name: string; bcCustomerNumber: string }
  lines:        OrderLine[]
}

// ─── Banner-typer ─────────────────────────────────────────────────────────────

type Banner =
  | { type: 'success'; count: number; bcNumbers: string[] }
  | { type: 'warning'; count: number; bcNumbers: string[]; errors: string[] }
  | { type: 'rejected'; count: number }

export default function ApprovalList({ initialOrders }: { initialOrders: Order[] }) {
  const [orders,   setOrders]   = useState(initialOrders)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set(initialOrders.map((o) => o.id)))
  const [banner,   setBanner]   = useState<Banner | null>(null)
  const [isPending, startTransition] = useTransition()

  // Grupper ordrer per leveringsdato
  const grouped = orders.reduce<Record<string, Order[]>>((acc, order) => {
    const key = order.deliveryDate.toISOString().split('T')[0]
    ;(acc[key] ??= []).push(order)
    return acc
  }, {})

  function toggleOrder(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAllForDate(dateKey: string) {
    const ids = (grouped[dateKey] ?? []).map((o) => o.id)
    const allSelected = ids.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        ids.forEach((id) => next.delete(id))
      } else {
        ids.forEach((id) => next.add(id))
      }
      return next
    })
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function showBannerFor(b: Banner) {
    setBanner(b)
    setTimeout(() => setBanner(null), 6000)
  }

  function handleApprove() {
    const ids = Array.from(selected)
    if (ids.length === 0) return

    startTransition(async () => {
      const { results } = await approveOrders(ids)

      // Fjern alle godkendte/forsøgte ordrer fra listen
      setOrders((prev) => prev.filter((o) => !ids.includes(o.id)))
      setSelected(new Set())

      const bcNumbers = results.flatMap((r) => r.bcOrderNumber ? [r.bcOrderNumber] : [])
      const errors    = results.flatMap((r) => r.bcError    ? [r.bcError]    : [])

      if (errors.length === 0) {
        showBannerFor({ type: 'success', count: ids.length, bcNumbers })
      } else {
        showBannerFor({ type: 'warning', count: ids.length, bcNumbers, errors })
      }
    })
  }

  function handleReject() {
    const ids = Array.from(selected)
    if (ids.length === 0) return

    startTransition(async () => {
      await rejectOrders(ids)
      setOrders((prev) => prev.filter((o) => !ids.includes(o.id)))
      setSelected(new Set())
      showBannerFor({ type: 'rejected', count: ids.length })
    })
  }

  if (orders.length === 0 && !banner) {
    return (
      <div className="rounded-xl bg-white px-6 py-16 text-center text-gray-500 ring-1 ring-gray-200">
        <CheckCircle2 size={40} className="mx-auto mb-3 text-green-400" />
        <p className="font-medium">Ingen ordrer afventer</p>
        <p className="mt-1 text-sm">Nye ordrer vil dukke op her automatisk</p>
      </div>
    )
  }

  const fmt = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })

  return (
    <div className="space-y-6">

      {/* ── Banner ── */}
      {banner && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          banner.type === 'success'  ? 'bg-green-50 text-green-800' :
          banner.type === 'warning'  ? 'bg-amber-50  text-amber-800' :
                                       'bg-gray-50   text-gray-700'
        }`}>
          {banner.type === 'success' && (
            <div>
              <span className="font-semibold">
                ✓ {banner.count} {banner.count === 1 ? 'ordre' : 'ordrer'} sendt til BC
              </span>
              {banner.bcNumbers.length > 0 && (
                <span className="ml-2 font-mono text-xs">
                  ({banner.bcNumbers.join(', ')})
                </span>
              )}
            </div>
          )}
          {banner.type === 'warning' && (
            <div>
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={16} />
                {banner.bcNumbers.length > 0
                  ? `${banner.bcNumbers.length} ordre(r) sendt til BC — ${banner.errors.length} BC-fejl`
                  : `${banner.errors.length} ordre(r) godkendt lokalt — BC fejlede`}
              </div>
              {banner.bcNumbers.length > 0 && (
                <div className="mt-0.5 font-mono text-xs">
                  BC-numre: {banner.bcNumbers.join(', ')}
                </div>
              )}
              <ul className="mt-1 space-y-0.5 text-xs">
                {banner.errors.map((e, i) => (
                  <li key={i} className="font-mono">• {e}</li>
                ))}
              </ul>
            </div>
          )}
          {banner.type === 'rejected' && (
            <span>✗ {banner.count} {banner.count === 1 ? 'ordre' : 'ordrer'} afvist</span>
          )}
        </div>
      )}

      {/* ── Handlingsbar ── */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500">
          {selected.size > 0 ? `${selected.size} valgt` : 'Vælg ordrer herunder'}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={handleApprove}
            disabled={selected.size === 0 || isPending}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40"
          >
            {isPending
              ? <Loader2 size={16} className="animate-spin" />
              : <CheckCircle2 size={16} />}
            Godkend &amp; send til BC
          </button>
          <button
            onClick={handleReject}
            disabled={selected.size === 0 || isPending}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <XCircle size={16} />
            Afvis
          </button>
        </div>
      </div>

      {/* ── Ordrer grupperet per leveringsdato ── */}
      {Object.entries(grouped).map(([dateKey, dayOrders]) => {
        const date        = new Date(dateKey)
        const allSelected = dayOrders.every((o) => selected.has(o.id))

        return (
          <div key={dateKey}>
            {/* Dato-header */}
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                Levering:{' '}
                {date.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' })}
                <span className="ml-2 text-gray-400">({dayOrders.length} {dayOrders.length === 1 ? 'ordre' : 'ordrer'})</span>
              </h2>
              <button
                onClick={() => selectAllForDate(dateKey)}
                className="text-xs text-blue-600 hover:underline"
              >
                {allSelected ? 'Fravælg alle' : 'Vælg alle for denne dag'}
              </button>
            </div>

            <div className="space-y-2">
              {dayOrders.map((order) => {
                const isSelected = selected.has(order.id)
                const isExpanded = expanded.has(order.id)
                const total      = order.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)

                return (
                  <div
                    key={order.id}
                    className={`overflow-hidden rounded-xl bg-white ring-1 transition ${
                      isSelected ? 'ring-blue-400 shadow-sm' : 'ring-gray-200'
                    }`}
                  >
                    {/* Ordre-header */}
                    <div
                      className="flex cursor-pointer items-center gap-3 px-4 py-3"
                      onClick={() => toggleOrder(order.id)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOrder(order.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900 truncate">
                            {order.customer.name}
                          </span>
                          <span className="text-xs text-gray-400">
                            #{order.customer.bcCustomerNumber}
                          </span>
                          {order.bcOrderNumber && (
                            <span className="rounded bg-green-100 px-1.5 py-0.5 font-mono text-xs text-green-700">
                              BC: {order.bcOrderNumber}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {order.lines.length} {order.lines.length === 1 ? 'linje' : 'linjer'}
                          {total > 0 && ` · ${fmt.format(total)}`}
                          {order.notes && ` · "${order.notes}"`}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleExpand(order.id) }}
                        className="shrink-0 text-gray-400 hover:text-gray-600"
                      >
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </button>
                    </div>

                    {/* Ordrelinjer */}
                    {isExpanded && (
                      <div className="border-t border-gray-100">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-xs font-medium text-gray-500">
                              <th className="px-4 py-2 text-left">Varenr.</th>
                              <th className="px-4 py-2 text-left">Varenavn</th>
                              <th className="px-4 py-2 text-right">Antal</th>
                              <th className="px-4 py-2 text-left">Enhed</th>
                              <th className="px-4 py-2 text-right">Pris/enhed</th>
                              <th className="px-4 py-2 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {order.lines.map((line) => (
                              <tr key={line.id} className="hover:bg-gray-50">
                                <td className="px-4 py-2.5 font-mono text-xs text-gray-500">
                                  {line.bcItemNumber}
                                </td>
                                <td className="px-4 py-2.5 text-gray-900">{line.itemName}</td>
                                <td className="px-4 py-2.5 text-right font-semibold">{line.quantity}</td>
                                <td className="px-4 py-2.5 text-gray-500">{line.uom}</td>
                                <td className="px-4 py-2.5 text-right text-gray-500">
                                  {line.unitPrice > 0 ? fmt.format(line.unitPrice) : '—'}
                                </td>
                                <td className="px-4 py-2.5 text-right font-semibold">
                                  {line.unitPrice > 0 ? fmt.format(line.quantity * line.unitPrice) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
