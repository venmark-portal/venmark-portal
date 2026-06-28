'use client'

import { useMemo, useState } from 'react'
import type { SalgslisteRow } from '@/lib/businesscentral'

function fmt(n: number): string {
  return n.toLocaleString('da-DK', { maximumFractionDigits: 2 })
}

export default function SalgslisteTabel({ rows }: { rows: SalgslisteRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      r => r.itemNo.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
    )
  }, [rows, query])

  const totalSalg = useMemo(() => filtered.reduce((s, r) => s + r.salg, 0), [filtered])

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Søg varenr. eller beskrivelse…"
          className="w-72 max-w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
        <span className="text-sm text-gray-500">
          {filtered.length} vare(r) · samlet salg {fmt(totalSalg)}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2">Varenr.</th>
              <th className="px-3 py-2">Beskrivelse</th>
              <th className="px-3 py-2 text-right">Salg</th>
              <th className="px-3 py-2 text-right">Lager</th>
              <th className="px-3 py-2 text-right">I prod.</th>
              <th className="px-3 py-2 text-right">I køb</th>
              <th className="px-3 py-2">Enhed</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                  Ingen varer med salg, lager, køb eller produktion på den valgte dato.
                </td>
              </tr>
            )}
            {filtered.map(r => {
              const key = `${r.itemNo}|${r.uom}`
              const isOpen = expanded.has(key)
              const canDrill = r.customers.length > 0
              return (
                <FragmentRow
                  key={key}
                  row={r}
                  isOpen={isOpen}
                  canDrill={canDrill}
                  onToggle={() => canDrill && toggle(key)}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FragmentRow({
  row, isOpen, canDrill, onToggle,
}: {
  row: SalgslisteRow
  isOpen: boolean
  canDrill: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className={`border-b border-gray-100 ${canDrill ? 'cursor-pointer hover:bg-blue-50' : ''}`}
        onClick={onToggle}
      >
        <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
          {canDrill && (
            <span className="mr-1 inline-block w-3 text-gray-400">{isOpen ? '▾' : '▸'}</span>
          )}
          {row.itemNo}
        </td>
        <td className="px-3 py-2 text-gray-700">{row.description}</td>
        <td className="px-3 py-2 text-right font-semibold text-gray-900">
          {row.salg ? fmt(row.salg) : '—'}
        </td>
        <td className="px-3 py-2 text-right text-gray-700">{fmt(row.lager)}</td>
        <td className="px-3 py-2 text-right text-gray-700">{fmt(row.iProduktion)}</td>
        <td className="px-3 py-2 text-right text-gray-700">{fmt(row.iKoeb)}</td>
        <td className="px-3 py-2 text-gray-500">{row.uom}</td>
      </tr>
      {isOpen && (
        <tr className="bg-gray-50">
          <td colSpan={7} className="px-3 py-2">
            <div className="ml-4 rounded-md border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-1.5">Kunde</th>
                    <th className="px-3 py-1.5">Debitornr.</th>
                    <th className="px-3 py-1.5 text-right">Antal</th>
                  </tr>
                </thead>
                <tbody>
                  {row.customers.map(c => (
                    <tr key={c.customerNo} className="border-t border-gray-100">
                      <td className="px-3 py-1.5 text-gray-800">{c.customerName}</td>
                      <td className="px-3 py-1.5 text-gray-500">{c.customerNo}</td>
                      <td className="px-3 py-1.5 text-right text-gray-800">{fmt(c.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
