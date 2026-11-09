'use client'

import { useMemo, useState } from 'react'
import type { SalgslisteCustomer, SalgslisteRow } from '@/lib/businesscentral'

function fmt(n: number): string {
  return n.toLocaleString('da-DK', { maximumFractionDigits: 2 })
}

// 0 vises som tom celle — så de tal der ER der, springer i øjnene.
function blank(n: number): string {
  return n ? fmt(n) : ''
}

// Alle kundens bemærkninger på varen samlet til ÉN linje (portal + intern).
function noteLine(c: SalgslisteCustomer): string {
  return [...c.portalNotes, ...c.comments].join(' · ')
}

function hasNote(c: SalgslisteCustomer): boolean {
  return c.portalNotes.length + c.comments.length > 0
}

// Varenumre er tal-strenge (00000..40000) — sammenlign numerisk når begge er tal,
// ellers alfabetisk, så "4000" ikke havner efter "39999" som tekst.
function cmpItemNo(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) - Number(b)
  return a.localeCompare(b, 'da')
}

export default function SalgslisteTabel({ rows, datoTekst }: { rows: SalgslisteRow[]; datoTekst: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [kunNoter, setKunNoter] = useState(false)
  const [fra, setFra] = useState('00000')
  const [til, setTil] = useState('40000')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      r => r.itemNo.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
    )
  }, [rows, query])

  const totalSalg = useMemo(() => filtered.reduce((s, r) => s + r.salg, 0), [filtered])

  // Kun varer med kundesalg kan foldes ud. "Alle" = de viste (filtrerede) varer.
  const drillKeys = useMemo(
    () => filtered.filter(r => r.customers.length > 0).map(r => `${r.itemNo}|${r.uom}`),
    [filtered],
  )
  const noteKeys = useMemo(
    () => filtered.filter(r => r.customers.some(hasNote)).map(r => `${r.itemNo}|${r.uom}`),
    [filtered],
  )
  const allOpen = !kunNoter && drillKeys.length > 0 && drillKeys.every(k => expanded.has(k))

  function toggleAll() {
    setKunNoter(false)
    setExpanded(prev => {
      const next = new Set(prev)
      if (allOpen) drillKeys.forEach(k => next.delete(k))
      else drillKeys.forEach(k => next.add(k))
      return next
    })
  }

  // "Kun bemærkninger": fold KUN varer med bemærkning ud og vis kun de kunder der har
  // skrevet noget. Resten står som totaler.
  function toggleKunNoter() {
    if (kunNoter) {
      setKunNoter(false)
      setExpanded(new Set())
    } else {
      setKunNoter(true)
      setExpanded(new Set(noteKeys))
    }
  }

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const printRows = useMemo(
    () =>
      rows
        .filter(r => cmpItemNo(r.itemNo, fra.trim() || '0') >= 0 && cmpItemNo(r.itemNo, til.trim() || '99999999') <= 0)
        .sort((a, b) => cmpItemNo(a.itemNo, b.itemNo)),
    [rows, fra, til],
  )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Søg varenr. eller beskrivelse…"
            className="w-72 max-w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={toggleKunNoter}
            disabled={!kunNoter && noteKeys.length === 0}
            className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40 ${
              kunNoter
                ? 'border-amber-400 bg-amber-100 text-amber-900'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            💬 Kun bemærkninger{noteKeys.length > 0 ? ` (${noteKeys.length})` : ''}
          </button>
          <button
            type="button"
            onClick={toggleAll}
            disabled={drillKeys.length === 0}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            {allOpen ? '▴ Fold alle sammen' : '▾ Udvid alle'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">
            {filtered.length} vare(r) · samlet salg {fmt(totalSalg)}
          </span>
          <span className="ml-2 text-gray-500">Varenr.</span>
          <input
            value={fra}
            onChange={e => setFra(e.target.value)}
            className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            aria-label="Fra varenr."
          />
          <span className="text-gray-400">..</span>
          <input
            value={til}
            onChange={e => setTil(e.target.value)}
            className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            aria-label="Til varenr."
          />
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-900"
          >
            🖨 Udskriv A4
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white print:hidden">
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
                  kunNoter={kunNoter}
                  onToggle={() => canDrill && toggle(key)}
                />
              )
            })}
          </tbody>
        </table>
      </div>

      <PrintVersion rows={printRows} datoTekst={datoTekst} fra={fra} til={til} />
    </div>
  )
}

function FragmentRow({
  row, isOpen, canDrill, kunNoter, onToggle,
}: {
  row: SalgslisteRow
  isOpen: boolean
  canDrill: boolean
  kunNoter: boolean
  onToggle: () => void
}) {
  const noteCount = row.customers.filter(hasNote).length
  const customers = kunNoter ? row.customers.filter(hasNote) : row.customers
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
        <td className="px-3 py-2 text-gray-700">
          {row.description}
          {noteCount > 0 && (
            <span
              className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
              title="Der er bemærkninger på salgslinjerne — klik for at se dem"
            >
              💬 {noteCount}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right font-semibold text-gray-900">
          {blank(row.salg)}
        </td>
        <td className="px-3 py-2 text-right text-gray-700">{blank(row.lager)}</td>
        <td className="px-3 py-2 text-right text-gray-700">{blank(row.iProduktion)}</td>
        <td className="px-3 py-2 text-right text-gray-700">{blank(row.iKoeb)}</td>
        <td className="px-3 py-2 text-gray-500">{row.uom}</td>
      </tr>
      {isOpen && customers.length > 0 && (
        <tr className="bg-gray-50">
          <td colSpan={7} className="px-3 py-2">
            <div className="ml-4 rounded-md border border-gray-200 bg-white">
              <table className="w-full table-fixed text-sm">
                <tbody>
                  {customers.map((c, i) => {
                    const note = noteLine(c)
                    return (
                      <tr key={c.customerNo} className={`${i > 0 ? 'border-t border-gray-100' : ''} align-top`}>
                        {/* Kunde + bemærkning på SAMME linje — hele teksten ved mouse-over */}
                        <td className="px-3 py-1.5 text-gray-800">
                          <div className="flex min-w-0 gap-3">
                            <span className="shrink-0">{c.customerName}</span>
                            {note && (
                              <span className="truncate font-bold text-red-600" title={note}>
                                {note}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">{c.customerNo}</td>
                        <td className="px-3 py-1.5 text-right text-gray-800">{fmt(c.qty)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// A4-udskrift i samme stil som BC's lageropgørelse: stående A4, store læsbare rækker,
// totaler pr. vare og kun de kunder der har en bemærkning (én linje under varen).
function PrintVersion({
  rows, datoTekst, fra, til,
}: {
  rows: SalgslisteRow[]
  datoTekst: string
  fra: string
  til: string
}) {
  return (
    <div className="hidden print:block">
      <style>{'@page { size: A4 portrait; margin: 10mm 10mm; }'}</style>
      <div className="mb-3 flex items-end justify-between border-b-2 border-black pb-1">
        <div className="text-[18pt] font-bold">Salgsliste — afsendelse {datoTekst}</div>
        <div className="text-[10pt]" suppressHydrationWarning>
          Venmark Fisk A/S · Varenr. {fra}..{til} · udskrevet {new Date().toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' })}
        </div>
      </div>
      <table className="w-full table-fixed border-collapse text-[11pt]">
        <thead className="table-header-group">
          <tr className="border-b border-black text-left text-[10pt] font-bold">
            <th className="w-16 py-1 pr-2">Varenr.</th>
            <th className="py-1 pr-2">Beskrivelse</th>
            <th className="w-20 py-1 pr-2 text-right">Salg</th>
            <th className="w-12 py-1 pr-2">Enhed</th>
            <th className="w-20 py-1 pr-2 text-right">Lager</th>
            <th className="w-20 py-1 pr-2 text-right">I prod.</th>
            <th className="w-20 py-1 text-right">I køb</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-center">Ingen varer i intervallet.</td>
            </tr>
          )}
          {rows.map(r => {
            const noter = r.customers.filter(hasNote)
            return (
              <tr key={`${r.itemNo}|${r.uom}`} className="break-inside-avoid border-b border-gray-400 align-top">
                <td className="py-1 pr-2 font-semibold">{r.itemNo}</td>
                <td className="py-1 pr-2">
                  {r.description}
                  {noter.map(c => (
                    <div key={c.customerNo} className="truncate text-[9pt] font-bold" style={{ color: '#d40000', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                      {c.customerName} {fmt(c.qty)} {r.uom}: {noteLine(c)}
                    </div>
                  ))}
                </td>
                <td className="py-1 pr-2 text-right font-bold">{blank(r.salg)}</td>
                <td className="py-1 pr-2">{r.uom}</td>
                <td className="py-1 pr-2 text-right">{blank(r.lager)}</td>
                <td className="py-1 pr-2 text-right">{blank(r.iProduktion)}</td>
                <td className="py-1 text-right">{blank(r.iKoeb)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
