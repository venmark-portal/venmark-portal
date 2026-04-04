'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Save, CheckCircle2, ArrowLeft, Plus, GripVertical, Map } from 'lucide-react'

interface BCOrder {
  id: string; number: string; customerNumber: string; customerName: string
  shipToPostCode: string; shipToCity: string
  totalWeightKg: number; deliveryCodes: string[]
}

interface DeliveryCode { id: string; code: string; name: string }

interface PlanRow {
  id: string            // BC order id
  number: string        // BC order number
  customerNo: string
  customerName: string
  postCode: string
  city: string
  weightKg: number
  code: string          // leveringskode
  bil: string           // 'Bil 1', 'Bil 2', ...
  routeOrder: number    // Rækkefølge — 1 er først, 10000 sidst
}

// Leveringskoder der vises i tabellen (og som grupper)
function isVisibleCode(code: string): boolean {
  const u = code.toUpperCase().trim()
  return u === 'LOVENCO' || /^[AKS]/.test(u)
}

function mkKey() { return Math.random().toString(36).slice(2) }

function mapsLinks(stops: PlanRow[]): string[] {
  const links: string[] = []
  for (let i = 0; i < stops.length; i += 10) {
    const addrs = stops.slice(i, i + 10).map(r => encodeURIComponent(`${r.postCode} ${r.city}`))
    links.push('https://www.google.com/maps/dir/' + addrs.join('/'))
  }
  return links
}

export default function LeveringDagPage() {
  const { date } = useParams<{ date: string }>()
  const [rows,    setRows]    = useState<PlanRow[]>([])
  const [bils,    setBils]    = useState<string[]>(['Bil 1'])
  const [dcodes,  setDcodes]  = useState<DeliveryCode[]>([])
  const [bcError, setBcError] = useState<string | null>(null)
  const [notes,   setNotes]   = useState('')
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [drag,    setDrag]    = useState<{ code: string; idx: number } | null>(null)

  const load = useCallback(async () => {
    let d: any
    try {
      const r = await fetch(`/api/admin/leveringer/${date}`)
      if (!r.ok) { setBcError(`API fejl ${r.status}`); setLoading(false); return }
      d = await r.json()
    } catch (e) {
      setBcError(`Netværksfejl: ${e instanceof Error ? e.message : String(e)}`)
      setLoading(false)
      return
    }
    setBcError(d.bcError ?? null)
    setDcodes(d.deliveryCodes ?? [])
    setNotes((d.routeRows ?? [])[0]?.routeNotes ?? '')

    const profiles: Record<string, number> = d.routeProfiles ?? {}

    // Byg opslag: ordreId → { vehicleLabel, sortOrder } fra eksisterende rute
    const routeMap = new Map<string, { bil: string; sort: number }>()
    const bilSet   = new Set<string>()
    for (const row of (d.routeRows ?? [])) {
      if (!row.bcSalesOrderId) continue
      routeMap.set(row.bcSalesOrderId, {
        bil:  row.vehicleLabel ?? 'Bil 1',
        sort: row.sortOrder    ?? 99,
      })
      if (row.vehicleLabel) bilSet.add(row.vehicleLabel)
    }
    if (bilSet.size > 0) setBils(Array.from(bilSet).sort())

    const orders: BCOrder[] = d.bcOrders ?? []
    const planRows: PlanRow[] = []

    for (const o of orders) {
      const code = o.deliveryCodes.find(c => isVisibleCode(c)) ?? o.deliveryCodes[0] ?? '–'
      if (!isVisibleCode(code)) continue
      const existing = routeMap.get(o.id)
      planRows.push({
        id:           o.id,
        number:       o.number,
        customerNo:   o.customerNumber ?? '',
        customerName: o.customerName,
        postCode:     o.shipToPostCode,
        city:         o.shipToCity,
        weightKg:     o.totalWeightKg ?? 0,
        code,
        bil:          existing?.bil ?? 'Bil 1',
        routeOrder:   profiles[o.customerNumber ?? ''] ?? 5000,
      })
    }

    // Sorter: kode → routeOrder → kundenavn
    planRows.sort((a, b) => {
      if (a.code !== b.code) return a.code.localeCompare(b.code)
      if (a.routeOrder !== b.routeOrder) return a.routeOrder - b.routeOrder
      return a.customerName.localeCompare(b.customerName, 'da')
    })

    setRows(planRows)
    setLoading(false)
  }, [date])

  useEffect(() => {
    const failsafe = setTimeout(() => {
      setLoading(false)
      setBcError('Timeout — API svarede ikke inden for 20 sekunder. Prøv at genindlæse siden.')
    }, 20_000)
    load().finally(() => clearTimeout(failsafe))
  }, [load])

  const allBils = Array.from(new Set([...bils, ...rows.map(r => r.bil)])).sort()
  // Dropdown viser kun A/K/S/LOVENCO koder
  const allCodes = Array.from(new Set(dcodes.map(dc => dc.code).filter(isVisibleCode))).sort()

  function updateRow(id: string, patch: Partial<PlanRow>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  function changeCode(row: PlanRow, newCode: string) {
    if (newCode === row.code) return
    if (!confirm(`Flyt "${row.customerName}" fra ${row.code} til ${newCode}?`)) return
    // Flyt til bunden af ny gruppe (høj routeOrder)
    updateRow(row.id, { code: newCode })
  }

  function addBil() {
    const next = `Bil ${allBils.length + 1}`
    setBils(prev => [...prev, next])
  }

  // Fordel kunder på biler baseret på nuværende rækkefølge — lighed fordeles på skift
  function rebalanceBils() {
    if (allBils.length < 2) return
    setRows(prev => {
      const result = [...prev]
      // Per kodegruppe: fordel på biler i rækkefølge (round-robin per bil)
      const codes = Array.from(new Set(prev.map(r => r.code)))
      for (const code of codes) {
        const indices = result.map((r, i) => r.code === code ? i : -1).filter(i => i >= 0)
        indices.forEach((rowIdx, pos) => {
          result[rowIdx] = { ...result[rowIdx], bil: allBils[pos % allBils.length] }
        })
      }
      return result
    })
  }

  // Drag-and-drop inden for samme kodegruppe
  function onDragStart(code: string, idx: number) { setDrag({ code, idx }) }
  function onDrop(code: string, toIdx: number) {
    if (!drag || drag.code !== code || drag.idx === toIdx) { setDrag(null); return }
    setRows(prev => {
      const group  = prev.filter(r => r.code === code)
      const rest   = prev.filter(r => r.code !== code)
      const [moved] = group.splice(drag.idx, 1)
      group.splice(toIdx, 0, moved)
      // Tildel ny routeOrder ud fra ny rækkefølge (10, 20, 30…)
      group.forEach((r, i) => { r.routeOrder = (i + 1) * 10 })
      const result: PlanRow[] = []
      let gi = 0
      for (const r of prev) {
        result.push(r.code === code ? group[gi++] : rest.shift()!)
      }
      return result
    })
    setDrag(null)
  }

  async function save() {
    setSaving(true); setSaved(false)

    // Byg vehicles/stops til rute-API
    const vehicleMap = new Map<string, any[]>()
    for (const r of rows) {
      if (!vehicleMap.has(r.bil)) vehicleMap.set(r.bil, [])
      vehicleMap.get(r.bil)!.push({
        _key:                 mkKey(),
        bcSalesOrderId:       r.id,
        bcSalesOrderNo:       r.number,
        customerName:         r.customerName,
        customerAddress:      `${r.postCode} ${r.city}`.trim(),
        totalWeightKg:        r.weightKg,
        deliveryCodeOverride: r.code,
      })
    }
    const vehicles = Array.from(vehicleMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, stops]) => ({ _key: mkKey(), vehicleLabel: label, driverId: '', stops }))

    // Byg routeProfiles til persistering
    const routeProfiles = rows.map(r => ({ customerNo: r.customerNo, routeOrder: r.routeOrder }))

    await fetch(`/api/admin/leveringer/${date}/rute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicles, notes, routeProfiles }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <div className="py-16 text-center text-sm text-gray-400">Henter ordrer fra BC…</div>

  const dkDate = new Date(date + 'T12:00:00').toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  // Grupper rows pr. kode (kun synlige koder)
  const groups = new Map<string, PlanRow[]>()
  for (const r of rows) {
    if (!groups.has(r.code)) groups.set(r.code, [])
    groups.get(r.code)!.push(r)
  }
  const sortedCodes = Array.from(groups.keys()).sort()

  return (
    <div className="space-y-4 max-w-5xl">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <a href="/admin/leveringer" className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-1">
            <ArrowLeft size={12} /> Alle leveringsdage
          </a>
          <h1 className="text-2xl font-bold text-gray-900 capitalize">{dkDate}</h1>
          <p className="text-sm text-gray-500">
            {rows.length} kunder · {sortedCodes.length} ruter · {allBils.length} bil{allBils.length !== 1 ? 'er' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={addBil}
            className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
            <Plus size={13} /> Tilføj bil
          </button>
          {allBils.length > 1 && (
            <button onClick={rebalanceBils}
              className="flex items-center gap-1 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700 hover:bg-orange-100">
              Fordel på {allBils.length} biler
            </button>
          )}
          {saved && (
            <span className="flex items-center gap-1 text-sm text-green-600 font-medium">
              <CheckCircle2 size={15} /> Gemt
            </span>
          )}
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            <Save size={15} /> {saving ? 'Gemmer…' : 'Gem rute'}
          </button>
        </div>
      </div>

      {bcError && (
        <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700 ring-1 ring-red-200">{bcError}</div>
      )}

      {/* ── Tabel ── */}
      <div className="rounded-xl bg-white ring-1 ring-gray-200 overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-14 text-center text-sm text-gray-400">
            Ingen ordrer med leveringskoder (A / K / S / LOVENCO) for denne dato
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="w-7 px-2 py-2.5" />
                <th className="px-3 py-2.5 text-left">Kunde</th>
                <th className="px-3 py-2.5 text-left w-16">Postnr</th>
                <th className="px-3 py-2.5 text-left">By</th>
                <th className="px-3 py-2.5 text-right w-16">Kg</th>
                <th className="px-3 py-2.5 text-center w-20" title="Rækkefølge inden for gruppen (1 = først)">Rækkef.</th>
                <th className="px-3 py-2.5 text-left w-36">Leveringskode</th>
                <th className="px-3 py-2.5 text-left w-28">Bil</th>
              </tr>
            </thead>
            <tbody>
              {sortedCodes.map(code => {
                const codeRows = groups.get(code)!
                const dcName   = dcodes.find(dc => dc.code === code)?.name ?? ''
                const totalKg  = codeRows.reduce((s, r) => s + (r.weightKg ?? 0), 0)
                const bilsUsed = Array.from(new Set(codeRows.map(r => r.bil))).sort()

                return [
                  <tr key={`hdr-${code}`} className="bg-blue-50 border-t-2 border-blue-100">
                    <td colSpan={8} className="px-4 py-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-mono font-bold text-blue-800">{code}</span>
                        {dcName && <span className="text-xs text-blue-600">{dcName}</span>}
                        <span className="ml-auto text-xs text-gray-400">
                          {codeRows.length} kunder
                          {totalKg > 0 && <> · {totalKg.toFixed(0)} kg</>}
                        </span>
                        {bilsUsed.map(bil => {
                          const links = mapsLinks(codeRows.filter(r => r.bil === bil))
                          return links.map((url, i) => (
                            <a key={`${bil}-${i}`} href={url} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1 rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-200 whitespace-nowrap">
                              <Map size={11} /> {bil}{links.length > 1 ? ` · kort ${i + 1}` : ''}
                            </a>
                          ))
                        })}
                      </div>
                    </td>
                  </tr>,

                  ...codeRows.map((r, idx) => {
                    // Vis bil-separator når bilen skifter inden for gruppen
                    const prevBil = idx > 0 ? codeRows[idx - 1].bil : null
                    const bilChanged = prevBil !== null && prevBil !== r.bil
                    return [
                    bilChanged ? (
                      <tr key={`bil-sep-${code}-${idx}`} className="bg-gray-100 border-t border-gray-300">
                        <td colSpan={8} className="px-4 py-1 text-xs font-semibold text-gray-500 tracking-wide">
                          {r.bil}
                        </td>
                      </tr>
                    ) : null,
                    <tr key={r.id}
                      draggable
                      onDragStart={() => onDragStart(code, idx)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => onDrop(code, idx)}
                      className={`border-b border-gray-50 hover:bg-gray-50 transition-opacity ${drag?.code === code && drag.idx === idx ? 'opacity-30' : ''}`}
                    >
                      <td className="px-2 py-2 text-gray-300 cursor-grab">
                        <GripVertical size={14} />
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{r.customerName}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">{r.postCode}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{r.city}</td>
                      <td className="px-3 py-2 text-right text-gray-400 text-xs tabular-nums">
                        {r.weightKg > 0 ? r.weightKg.toFixed(0) : '–'}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" min={1} max={10000}
                          value={r.routeOrder}
                          onChange={e => updateRow(r.id, { routeOrder: Number(e.target.value) || 5000 })}
                          onBlur={() => {
                            // Resorter gruppen når man forlader feltet
                            setRows(prev => {
                              const group = prev.filter(x => x.code === r.code)
                                .sort((a, b) => a.routeOrder - b.routeOrder || a.customerName.localeCompare(b.customerName, 'da'))
                              let gi = 0
                              return prev.map(x => x.code === r.code ? group[gi++] : x)
                            })
                          }}
                          className="w-16 rounded border border-gray-200 px-2 py-1 text-xs text-center bg-white focus:border-blue-400 focus:outline-none tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select value={r.code}
                          onChange={e => changeCode(r, e.target.value)}
                          className="rounded border border-gray-200 px-2 py-1 text-xs bg-white focus:border-blue-400 focus:outline-none w-full">
                          {allCodes.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select value={r.bil}
                          onChange={e => updateRow(r.id, { bil: e.target.value })}
                          className="rounded border border-gray-200 px-2 py-1 text-xs bg-white focus:border-blue-400 focus:outline-none w-full">
                          {allBils.map(b => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                    ]
                  }).flat().filter(Boolean),
                ]
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Noter ── */}
      <div className="rounded-xl bg-white ring-1 ring-gray-200 p-4">
        <label className="mb-1.5 block text-xs font-medium text-gray-600">Noter til ruten</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none resize-none"
          placeholder="Ekstra instrukser, særlige hensyn…" />
      </div>
    </div>
  )
}
