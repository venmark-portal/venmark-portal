'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Save, CheckCircle2, XCircle, ArrowLeft, Plus, GripVertical, Map as MapIcon, Trash2 } from 'lucide-react'

interface BCOrder {
  id: string; number: string; customerNumber: string; customerName: string
  shipToPostCode: string; shipToCity: string
  totalWeightKg: number; deliveryCodes: string[]
}

interface DeliveryCode { id: string; code: string; name: string }

interface PlanRow {
  id: string            // BC order id (primær) eller 'extra-<uuid>'
  number: string
  customerNo: string
  customerName: string
  address: string
  postCode: string
  city: string
  weightKg: number
  code: string          // gruppe-kode
  originalCode: string
  bil: string
  routeOrder: number
  defaultVehicle: number
  merged?: { id: string; number: string; originalCode: string; weightKg: number }[]
  // Ekstra opgave
  isExtraTask?: boolean
  extraTaskTitle?: string
  extraTaskNote?: string
  stopId?: string       // eksisterende DB-id (til status-bevaring ved re-gem)
  stopStatus?: string   // PENDING | DELIVERED | FAILED
}

function isVisibleCode(code: string): boolean {
  const u = code.toUpperCase().trim()
  return u === 'LOVENCO' || /^[AKS]/.test(u)
}

function mergeKobIntoLovenco(rows: PlanRow[]): PlanRow[] {
  const absorbed = new Set<string>()
  const out: PlanRow[] = []
  for (const row of rows) {
    if (absorbed.has(row.id)) continue
    if (!row.isExtraTask && row.code === 'LOVENCO' && row.originalCode === 'LOVENCO' && row.address) {
      const partner = rows.find(r =>
        !absorbed.has(r.id) && !r.isExtraTask &&
        r.id !== row.id &&
        r.code === 'LOVENCO' &&
        /^KØB/i.test(r.originalCode) &&
        r.address.toLowerCase() === row.address.toLowerCase() &&
        r.postCode === row.postCode
      )
      if (partner) {
        absorbed.add(partner.id)
        out.push({
          ...row,
          weightKg: row.weightKg + partner.weightKg,
          merged: [{ id: partner.id, number: partner.number, originalCode: partner.originalCode, weightKg: partner.weightKg }],
        })
        continue
      }
    }
    out.push(row)
  }
  return out
}

function mkKey() { return Math.random().toString(36).slice(2) }

function mapsLinks(stops: PlanRow[]): string[] {
  const links: string[] = []
  const withAddr = stops.filter(r => !r.isExtraTask && r.address)
  for (let i = 0; i < withAddr.length; i += 10) {
    const addrs = withAddr.slice(i, i + 10).map(r =>
      encodeURIComponent([r.address, r.postCode, r.city].filter(Boolean).join(', '))
    )
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
    try {
      setBcError(d.bcError ?? null)
      setDcodes(d.deliveryCodes ?? [])
      setNotes((d.routeRows ?? [])[0]?.routeNotes ?? '')

      const profiles: Record<string, { routeOrder: number; defaultVehicle: number }> = d.routeProfiles ?? {}

      const routeMap = new Map<string, { bil: string; sort: number; stopId: string; stopStatus: string }>()
      const bilSet   = new Set<string>()
      for (const row of (d.routeRows ?? [])) {
        if (!row.bcSalesOrderId) continue
        routeMap.set(row.bcSalesOrderId, {
          bil:        row.vehicleLabel ?? 'Bil 1',
          sort:       row.sortOrder    ?? 99,
          stopId:     row.stopId,
          stopStatus: row.stopStatus   ?? 'PENDING',
        })
        if (row.vehicleLabel) bilSet.add(row.vehicleLabel)
      }
      if (bilSet.size > 0) setBils(Array.from(bilSet).sort())

      const orders: BCOrder[] = d.bcOrders ?? []
      const planRows: PlanRow[] = []

      for (const o of orders) {
        const codes: string[] = Array.isArray(o.deliveryCodes) ? o.deliveryCodes : []
        const originalCode = codes.find(c => isVisibleCode(c)) ?? codes[0] ?? '–'
        if (!isVisibleCode(originalCode)) continue
        const code = /^KØB/i.test(originalCode) ? 'LOVENCO' : originalCode
        const existing = routeMap.get(o.id)
        const profile  = profiles[o.customerNumber ?? '']
        const defaultVehicle = profile?.defaultVehicle ?? 0
        const defaultBil = defaultVehicle > 0 ? `Bil ${defaultVehicle}` : 'Bil 1'
        planRows.push({
          id:             o.id,
          number:         o.number,
          customerNo:     o.customerNumber ?? '',
          customerName:   o.customerName ?? '',
          address:        o.shipToAddress ?? '',
          postCode:       o.shipToPostCode ?? '',
          city:           o.shipToCity ?? '',
          weightKg:       o.totalWeightKg ?? 0,
          code,
          originalCode,
          bil:            existing?.bil ?? defaultBil,
          routeOrder:     existing?.sort ?? profile?.routeOrder ?? (o.portalRouteOrder > 0 ? o.portalRouteOrder : 5000),
          defaultVehicle,
          stopId:         existing?.stopId,
          stopStatus:     existing?.stopStatus ?? 'PENDING',
        })
      }

      // Tilføj ekstra opgaver fra gemt rute (ingen bcSalesOrderId)
      for (const row of (d.routeRows ?? [])) {
        if (!row.isExtraTask || !row.stopId) continue
        const code = row.deliveryCodeOverride ?? 'LOVENCO'
        if (row.vehicleLabel) bilSet.add(row.vehicleLabel)
        planRows.push({
          id:             `extra-${row.stopId}`,
          number:         '',
          customerNo:     '',
          customerName:   row.extraTaskTitle ?? '',
          address:        '',
          postCode:       '',
          city:           '',
          weightKg:       0,
          code,
          originalCode:   code,
          bil:            row.vehicleLabel ?? 'Bil 1',
          routeOrder:     row.sortOrder ?? 5000,
          defaultVehicle: 0,
          isExtraTask:    true,
          extraTaskTitle: row.extraTaskTitle ?? '',
          extraTaskNote:  row.extraTaskNote  ?? '',
          stopId:         row.stopId,
          stopStatus:     row.stopStatus ?? 'PENDING',
        })
      }
      if (bilSet.size > 0) setBils(Array.from(bilSet).sort())

      planRows.sort((a, b) => {
        if (a.code !== b.code) return a.code.localeCompare(b.code)
        if (a.bil  !== b.bil)  return a.bil.localeCompare(b.bil)
        if (a.routeOrder !== b.routeOrder) return a.routeOrder - b.routeOrder
        return a.customerName.localeCompare(b.customerName, 'da')
      })

      setRows(mergeKobIntoLovenco(planRows))
    } catch (e) {
      setBcError(`Behandlingsfejl: ${e instanceof Error ? e.message : String(e)}`)
    }
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
  const allCodes = Array.from(new Set(dcodes.map(dc => dc.code).filter(isVisibleCode))).sort()

  function updateRow(id: string, patch: Partial<PlanRow>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  function deleteRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  function changeCode(row: PlanRow, newCode: string) {
    if (newCode === row.code) return
    const label = row.isExtraTask ? (row.extraTaskTitle || 'Ekstra opgave') : row.customerName
    if (!confirm(`Flyt "${label}" fra ${row.code} til ${newCode}?`)) return
    updateRow(row.id, { code: newCode })
  }

  function addBil() {
    const next = `Bil ${allBils.length + 1}`
    setBils(prev => [...prev, next])
  }

  function addExtraTask() {
    const id = `extra-new-${mkKey()}`
    const defaultCode = allCodes[0] ?? 'LOVENCO'
    const newRow: PlanRow = {
      id,
      number:         '',
      customerNo:     '',
      customerName:   '',
      address:        '',
      postCode:       '',
      city:           '',
      weightKg:       0,
      code:           defaultCode,
      originalCode:   defaultCode,
      bil:            allBils[0] ?? 'Bil 1',
      routeOrder:     9999,
      defaultVehicle: 0,
      isExtraTask:    true,
      extraTaskTitle: '',
      extraTaskNote:  '',
      stopStatus:     'PENDING',
    }
    setRows(prev => [...prev, newRow])
  }

  function onDragStart(code: string, idx: number) { setDrag({ code, idx }) }
  function onDrop(code: string, toIdx: number) {
    if (!drag || drag.code !== code || drag.idx === toIdx) { setDrag(null); return }
    setRows(prev => {
      const group  = prev.filter(r => r.code === code)
      const rest   = prev.filter(r => r.code !== code)
      const [moved] = group.splice(drag.idx, 1)
      group.splice(toIdx, 0, moved)
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

    const vehicleMap = new Map<string, any[]>()
    for (const r of rows) {
      if (!vehicleMap.has(r.bil)) vehicleMap.set(r.bil, [])
      vehicleMap.get(r.bil)!.push({
        _key:                 mkKey(),
        existingStopId:       r.stopId ?? null,
        bcSalesOrderId:       r.isExtraTask ? null : r.id,
        bcSalesOrderNo:       r.isExtraTask ? null : [r.number, ...(r.merged?.map(m => m.number) ?? [])].join(' + '),
        kobSalesOrderNo:      r.isExtraTask ? null : (r.merged?.[0]?.number ?? null),
        customerName:         r.isExtraTask ? null : r.customerName,
        customerAddress:      r.isExtraTask ? null : [r.address, r.postCode, r.city].filter(Boolean).join(', '),
        totalWeightKg:        r.isExtraTask ? null : (r.weightKg || null),
        deliveryCodeOverride: r.code,
        isExtraTask:          r.isExtraTask ?? false,
        extraTaskTitle:       r.isExtraTask ? (r.extraTaskTitle ?? '') : null,
        extraTaskNote:        r.isExtraTask ? (r.extraTaskNote  ?? null) : null,
      })
    }
    const vehicles = Array.from(vehicleMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, stops]) => ({ _key: mkKey(), vehicleLabel: label, driverId: '', stops }))

    const routeProfiles = rows
      .filter(r => !r.isExtraTask && r.customerNo)
      .map(r => ({ customerNo: r.customerNo, routeOrder: r.routeOrder, defaultVehicle: r.defaultVehicle }))

    await fetch(`/api/admin/leveringer/${date}/rute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicles, notes, routeProfiles }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => { setSaved(false); load() }, 2000)
  }

  if (loading) return <div className="py-16 text-center text-sm text-gray-400">Henter ordrer fra BC…</div>

  const dkDate = new Date(date + 'T12:00:00').toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const groups = new Map<string, PlanRow[]>()
  for (const r of rows) {
    if (!groups.has(r.code)) groups.set(r.code, [])
    groups.get(r.code)!.push(r)
  }
  const sortedCodes = Array.from(groups.keys()).sort()
  const allRows = sortedCodes.flatMap(c => groups.get(c)!)
  const rowIdx = new Map(allRows.map((r, i) => [r.id, i]))
  const n = allRows.length

  return (
    <div className="space-y-4 max-w-5xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <a href="/admin/leveringer" className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-1">
            <ArrowLeft size={12} /> Alle leveringsdage
          </a>
          <h1 className="text-2xl font-bold text-gray-900 capitalize">{dkDate}</h1>
          <p className="text-sm text-gray-500">
            {rows.length} stops · {sortedCodes.length} ruter · {allBils.length} bil{allBils.length !== 1 ? 'er' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={addBil}
            className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
            <Plus size={13} /> Tilføj bil
          </button>
          <button onClick={addExtraTask}
            className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
            <Plus size={13} /> Ekstra opgave
          </button>
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

      {/* Tabel */}
      <div className="rounded-xl bg-white ring-1 ring-gray-200 overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-14 text-center text-sm text-gray-400">
            Ingen stops — tilføj en ekstra opgave eller hent fra BC
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="w-7 px-2 py-2.5" />
                <th className="px-3 py-2.5 text-left">Kunde / Opgave</th>
                <th className="px-3 py-2.5 text-right w-16">Kg</th>
                <th className="px-3 py-2.5 text-center w-14" title="Standardbil (gemmes per kunde)">Std.bil</th>
                <th className="px-3 py-2.5 text-center w-20" title="Rækkefølge inden for gruppen">Rækkef.</th>
                <th className="px-3 py-2.5 text-left w-36">Leveringskode</th>
                <th className="px-3 py-2.5 text-left w-28">Bil</th>
                <th className="w-8 px-2 py-2.5" />
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
                          {codeRows.length} stops
                          {totalKg > 0 && <> · {totalKg.toFixed(0)} kg</>}
                        </span>
                        {bilsUsed.map(bil => {
                          const links = mapsLinks(codeRows.filter(r => r.bil === bil))
                          return links.map((url, i) => (
                            <a key={`${bil}-${i}`} href={url} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1 rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-200 whitespace-nowrap">
                              <MapIcon size={11} /> {bil}{links.length > 1 ? ` · kort ${i + 1}` : ''}
                            </a>
                          ))
                        })}
                      </div>
                    </td>
                  </tr>,

                  ...codeRows.map((r, idx) => {
                    const prevBil    = idx > 0 ? codeRows[idx - 1].bil : null
                    const bilChanged = prevBil !== null && prevBil !== r.bil
                    const gi         = rowIdx.get(r.id)!
                    const isDone     = r.stopStatus === 'DELIVERED' || r.stopStatus === 'FAILED'

                    return [
                      bilChanged ? (
                        <tr key={`bil-sep-${code}-${idx}`} className="bg-gray-100 border-t border-gray-300">
                          <td colSpan={8} className="px-4 py-1 text-xs font-semibold text-gray-500 tracking-wide">
                            {r.bil}
                          </td>
                        </tr>
                      ) : null,
                      <tr key={r.id}
                        draggable={!isDone}
                        onDragStart={() => !isDone && onDragStart(code, idx)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => onDrop(code, idx)}
                        className={`border-b border-gray-50 transition-opacity ${
                          isDone ? 'bg-green-50/60' :
                          drag?.code === code && drag.idx === idx ? 'opacity-30' : 'hover:bg-gray-50'
                        }`}
                      >
                        {/* Drag handle */}
                        <td className="px-2 py-2 text-gray-300 cursor-grab">
                          <GripVertical size={14} />
                        </td>

                        {/* Kunde / Ekstra opgave */}
                        <td className="px-3 py-2">
                          {r.isExtraTask ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-700">Ekstra</span>
                                <input
                                  type="text"
                                  value={r.extraTaskTitle ?? ''}
                                  onChange={e => updateRow(r.id, { extraTaskTitle: e.target.value, customerName: e.target.value })}
                                  placeholder="Titel på opgaven…"
                                  className="flex-1 rounded border border-gray-200 px-2 py-0.5 text-sm focus:border-blue-400 focus:outline-none"
                                />
                              </div>
                              <input
                                type="text"
                                value={r.extraTaskNote ?? ''}
                                onChange={e => updateRow(r.id, { extraTaskNote: e.target.value })}
                                placeholder="Evt. note til chauffør…"
                                className="w-full rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-500 focus:border-blue-400 focus:outline-none"
                              />
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium text-gray-900 text-sm">{r.customerName}</span>
                              {r.stopStatus === 'DELIVERED' && (
                                <CheckCircle2 size={13} className="text-green-600 shrink-0" title="Allerede leveret" />
                              )}
                              {r.stopStatus === 'FAILED' && (
                                <XCircle size={13} className="text-red-500 shrink-0" title="Fejlet" />
                              )}
                              {r.originalCode !== r.code && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono font-semibold text-amber-700">{r.originalCode}</span>
                              )}
                              {r.merged?.map(m => (
                                <span key={m.id} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono font-semibold text-amber-700">
                                  +{m.originalCode} {m.weightKg > 0 ? `${m.weightKg.toFixed(0)} kg` : ''}
                                </span>
                              ))}
                              {r.address && <div className="w-full text-xs text-gray-400">{r.address}, {r.postCode} {r.city}</div>}
                            </div>
                          )}
                        </td>

                        {/* Kg */}
                        <td className="px-3 py-2 text-right text-gray-400 text-xs tabular-nums">
                          {!r.isExtraTask && r.weightKg > 0 ? r.weightKg.toFixed(0) : '–'}
                        </td>

                        {/* Std.bil */}
                        <td className="px-3 py-2">
                          {!r.isExtraTask && (
                            <input
                              type="number" min={0} max={9}
                              value={r.defaultVehicle || ''}
                              placeholder="–"
                              tabIndex={gi + 1}
                              onChange={e => {
                                const v = Math.min(9, Math.max(0, Number(e.target.value) || 0))
                                updateRow(r.id, { defaultVehicle: v, bil: v > 0 ? `Bil ${v}` : r.bil })
                              }}
                              className="w-10 rounded border border-gray-200 px-1 py-1 text-xs text-center bg-white focus:border-blue-400 focus:outline-none tabular-nums"
                            />
                          )}
                        </td>

                        {/* Rækkefølge */}
                        <td className="px-3 py-2">
                          <input
                            type="number" min={1} max={10000}
                            value={r.routeOrder}
                            tabIndex={n + gi + 1}
                            onChange={e => updateRow(r.id, { routeOrder: Number(e.target.value) || 5000 })}
                            onBlur={() => {
                              setRows(prev => {
                                const group = prev.filter(x => x.code === r.code)
                                  .sort((a, b) => a.bil.localeCompare(b.bil) || a.routeOrder - b.routeOrder || a.customerName.localeCompare(b.customerName, 'da'))
                                let gi = 0
                                return prev.map(x => x.code === r.code ? group[gi++] : x)
                              })
                            }}
                            className="w-16 rounded border border-gray-200 px-2 py-1 text-xs text-center bg-white focus:border-blue-400 focus:outline-none tabular-nums"
                          />
                        </td>

                        {/* Leveringskode */}
                        <td className="px-3 py-2">
                          <select value={r.code}
                            tabIndex={2 * n + gi + 1}
                            onChange={e => changeCode(r, e.target.value)}
                            className="rounded border border-gray-200 px-2 py-1 text-xs bg-white focus:border-blue-400 focus:outline-none w-full">
                            {allCodes.map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </td>

                        {/* Bil */}
                        <td className="px-3 py-2">
                          <select value={r.bil}
                            tabIndex={3 * n + gi + 1}
                            onChange={e => updateRow(r.id, { bil: e.target.value })}
                            className="rounded border border-gray-200 px-2 py-1 text-xs bg-white focus:border-blue-400 focus:outline-none w-full">
                            {allBils.map(b => (
                              <option key={b} value={b}>{b}</option>
                            ))}
                          </select>
                        </td>

                        {/* Slet */}
                        <td className="px-2 py-2">
                          <button
                            onClick={() => {
                              const label = r.isExtraTask ? (r.extraTaskTitle || 'Ekstra opgave') : r.customerName
                              if (r.stopStatus === 'DELIVERED') {
                                if (!confirm(`${label} er allerede markeret som leveret. Slet alligevel?`)) return
                              }
                              deleteRow(r.id)
                            }}
                            title="Fjern fra ruten"
                            className="rounded p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>,
                    ]
                  }).flat().filter(Boolean),
                ]
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Noter */}
      <div className="rounded-xl bg-white ring-1 ring-gray-200 p-4">
        <label className="mb-1.5 block text-xs font-medium text-gray-600">Noter til ruten</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none resize-none"
          placeholder="Ekstra instrukser, særlige hensyn…" />
      </div>
    </div>
  )
}
