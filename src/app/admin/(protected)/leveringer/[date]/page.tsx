'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  Truck, Plus, Trash2, GripVertical, Save, ArrowLeft,
  Package, ShoppingCart, CheckCircle2, AlertCircle, Clock, User, Send, ChevronDown, ChevronUp
} from 'lucide-react'

// ─── Typer ────────────────────────────────────────────────────────────────────

interface BCOrderLine {
  id: string; itemNo: string; description: string; quantity: number; uom: string
}

interface BCOrder {
  id: string; number: string; customerName: string; shipToAddress: string
  shipToCity: string; shipToPostCode: string; shipToPhone: string
  status: string; totalWeightKg: number; deliveryCodes: string[]
  requestedDeliveryDate: string; lines: BCOrderLine[]
}

interface Driver { id: string; name: string; phone: string | null; isDefault: boolean }
interface DeliveryCode { id: string; code: string; name: string }

interface Stop {
  _key: string
  bcSalesOrderNo?: string; bcSalesOrderId?: string
  bcPurchaseOrderNo?: string; bcPurchaseOrderId?: string
  isExtraTask?: boolean; extraTaskTitle?: string; extraTaskNote?: string
  customerName?: string; customerAddress?: string; customerPhone?: string
  totalWeightKg?: number; driverId?: string
  deliveryCodeId?: string; deliveryCodeOverride?: string
  packedStatus?: string
}

interface Vehicle {
  _key: string; vehicleLabel: string; driverId: string; stops: Stop[]
}

const STATUS_COLORS: Record<string, string> = {
  Open:     'bg-yellow-100 text-yellow-800',
  Released: 'bg-green-100 text-green-700',
  Draft:    'bg-gray-100 text-gray-600',
}

// ─── Hjælpere ─────────────────────────────────────────────────────────────────

function key() { return Math.random().toString(36).slice(2) }

function orderInRoute(vehicles: Vehicle[], orderId: string) {
  return vehicles.some(v => v.stops.some(s => s.bcSalesOrderId === orderId))
}

// ─── Side ─────────────────────────────────────────────────────────────────────

export default function LeveringDagPage() {
  const { date } = useParams<{ date: string }>()
  const [bcOrders,       setBcOrders]       = useState<BCOrder[]>([])
  const [bcError,        setBcError]        = useState<string | null>(null)
  const [drivers,        setDrivers]        = useState<Driver[]>([])
  const [deliveryCodes,  setDeliveryCodes]  = useState<DeliveryCode[]>([])
  const [vehicles,       setVehicles]       = useState<Vehicle[]>([])
  const [notes,          setNotes]          = useState('')
  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [saved,          setSaved]          = useState(false)
  const [dragStop,       setDragStop]       = useState<{ vi: number; si: number } | null>(null)
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set())
  const [checkedLines,   setCheckedLines]   = useState<Set<string>>(new Set())

  function toggleOrderExpand(id: string) {
    setExpandedOrders(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleLine(id: string) {
    setCheckedLines(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/leveringer/${date}`)
    const d = await r.json()
    setBcOrders(d.bcOrders ?? [])
    setBcError(d.bcError ?? null)
    setDrivers(d.drivers ?? [])
    setDeliveryCodes(d.deliveryCodes ?? [])

    // Byg vehicles fra routeRows
    const rows: any[] = d.routeRows ?? []
    if (rows.length > 0 && rows[0].routeId) {
      const vMap = new Map<string, Vehicle>()
      for (const r of rows) {
        if (!r.vehicleId) continue
        if (!vMap.has(r.vehicleId)) {
          vMap.set(r.vehicleId, {
            _key: r.vehicleId, vehicleLabel: r.vehicleLabel,
            driverId: r.driverId ?? '', stops: [],
          })
        }
        if (r.stopId) {
          vMap.get(r.vehicleId)!.stops.push({
            _key: r.stopId,
            bcSalesOrderNo: r.bcSalesOrderNo, bcSalesOrderId: r.bcSalesOrderId,
            bcPurchaseOrderNo: r.bcPurchaseOrderNo, bcPurchaseOrderId: r.bcPurchaseOrderId,
            isExtraTask: Boolean(r.isExtraTask),
            extraTaskTitle: r.extraTaskTitle, extraTaskNote: r.extraTaskNote,
            customerName: r.customerName, customerAddress: r.customerAddress,
            customerPhone: r.customerPhone, totalWeightKg: r.totalWeightKg,
            driverId: r.stopDriverId, deliveryCodeId: r.deliveryCodeId,
            deliveryCodeOverride: r.deliveryCodeOverride, packedStatus: r.packedStatus,
          })
        }
      }
      setVehicles(Array.from(vMap.values()))
      setNotes(rows[0].routeNotes ?? '')
    } else {
      // Ny dag — byg biler fra chaufførernes defaultVehicleLabel
      // Gruppér standardchauffører per bil-label
      const bilMap = new Map<string, string>() // vehicleLabel → driverId
      for (const dr of (d.drivers as any[])) {
        const label = dr.defaultVehicleLabel ?? 'Bil 1'
        if (!bilMap.has(label)) bilMap.set(label, dr.id)
        else if (dr.isDefault) bilMap.set(label, dr.id) // standardchauffør vinder
      }
      if (bilMap.size === 0) {
        setVehicles([{ _key: key(), vehicleLabel: 'Bil 1', driverId: '', stops: [] }])
      } else {
        const vs: Vehicle[] = []
        let idx = 1
        bilMap.forEach((driverId, vehicleLabel) => {
          vs.push({ _key: key(), vehicleLabel, driverId, stops: [] })
          idx++
        })
        vs.sort((a, b) => a.vehicleLabel.localeCompare(b.vehicleLabel))
        setVehicles(vs)
      }
    }
    setLoading(false)
  }, [date])

  useEffect(() => { load() }, [load])

  // ── Tilføj BC-ordre til en bil ─────────────────────────────────────────────
  function addOrder(vi: number, order: BCOrder) {
    // Find første matchende leveringskode i vores DB
    const firstCode = deliveryCodes.find(dc => order.deliveryCodes.includes(dc.code))
    setVehicles(vs => vs.map((v, i) => i !== vi ? v : {
      ...v, stops: [...v.stops, {
        _key: key(),
        bcSalesOrderNo: order.number, bcSalesOrderId: order.id,
        customerName: order.customerName,
        customerAddress: `${order.shipToAddress}, ${order.shipToPostCode} ${order.shipToCity}`.trim().replace(/^,\s*/, ''),
        customerPhone: order.shipToPhone,
        totalWeightKg: order.totalWeightKg,
        deliveryCodeId: firstCode?.id,
      }],
    }))
  }

  // ── Tilføj ekstra opgave ───────────────────────────────────────────────────
  function addExtraTask(vi: number) {
    setVehicles(vs => vs.map((v, i) => i !== vi ? v : {
      ...v, stops: [...v.stops, { _key: key(), isExtraTask: true, extraTaskTitle: '' }],
    }))
  }

  // ── Slet stop ─────────────────────────────────────────────────────────────
  function removeStop(vi: number, si: number) {
    setVehicles(vs => vs.map((v, i) => i !== vi ? v : {
      ...v, stops: v.stops.filter((_, idx) => idx !== si),
    }))
  }

  // ── Opdater stop-felt ─────────────────────────────────────────────────────
  function updateStop(vi: number, si: number, patch: Partial<Stop>) {
    setVehicles(vs => vs.map((v, i) => i !== vi ? v : {
      ...v, stops: v.stops.map((s, idx) => idx !== si ? s : { ...s, ...patch }),
    }))
  }

  // ── Opdater bil ───────────────────────────────────────────────────────────
  function updateVehicle(vi: number, patch: Partial<Vehicle>) {
    setVehicles(vs => vs.map((v, i) => i !== vi ? v : { ...v, ...patch }))
  }

  // ── Tilføj bil ────────────────────────────────────────────────────────────
  function addVehicle() {
    setVehicles(vs => [...vs, {
      _key: key(), vehicleLabel: `Bil ${vs.length + 1}`, driverId: '', stops: [],
    }])
  }

  // ── Drag-and-drop stops ───────────────────────────────────────────────────
  function onDragStart(vi: number, si: number) { setDragStop({ vi, si }) }
  function onDragOver(e: React.DragEvent) { e.preventDefault() }
  function onDrop(vi: number, si: number) {
    if (!dragStop) return
    setVehicles(vs => {
      const next = vs.map(v => ({ ...v, stops: [...v.stops] }))
      const [stop] = next[dragStop.vi].stops.splice(dragStop.si, 1)
      next[vi].stops.splice(si, 0, stop)
      return next
    })
    setDragStop(null)
  }

  // ── Gem ───────────────────────────────────────────────────────────────────
  async function save() {
    setSaving(true); setSaved(false)
    await fetch(`/api/admin/leveringer/${date}/rute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicles, notes }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  // ── Beregn total vægt per bil ─────────────────────────────────────────────
  function totalKg(v: Vehicle) {
    return v.stops.reduce((s, stop) => s + (stop.totalWeightKg ?? 0), 0)
  }

  if (loading) return <div className="py-16 text-center text-sm text-gray-400">Henter ordrer fra BC…</div>

  const dkDate = new Date(date + 'T12:00:00').toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <a href="/admin/leveringer" className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-1">
            <ArrowLeft size={12} /> Alle leveringsdage
          </a>
          <h1 className="text-2xl font-bold text-gray-900 capitalize">{dkDate}</h1>
          <p className="text-sm text-gray-500">{bcOrders.length} ordre{bcOrders.length !== 1 ? 'r' : ''} fra BC · {vehicles.length} bil{vehicles.length !== 1 ? 'er' : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 size={15} /> Gemt</span>}
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            <Save size={15} /> {saving ? 'Gemmer…' : 'Gem rute'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* ── Venstre: BC-ordrer ─────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">BC-ordrer ({bcOrders.length})</h2>
            <p className="text-xs text-gray-400 mt-0.5">Testperiode: 16–30 marts 2026 · alle dage samlet</p>
          </div>
          {bcError && (
            <div className="rounded-xl bg-red-50 p-4 ring-1 ring-red-200 text-xs text-red-700 font-mono break-all">
              <div className="font-semibold mb-1">BC-fejl:</div>
              {bcError}
            </div>
          )}
          {!bcError && bcOrders.length === 0 && (
            <div className="rounded-xl bg-white p-6 text-center ring-1 ring-gray-200 text-sm text-gray-400">
              Ingen ordrer i BC for perioden
            </div>
          )}
          {bcOrders.map(o => {
            const inRoute  = orderInRoute(vehicles, o.id)
            const expanded = expandedOrders.has(o.id)
            const checkedCount = o.lines.filter(l => checkedLines.has(l.id)).length
            return (
              <div key={o.id}
                className={`rounded-xl bg-white ring-1 ring-gray-200 overflow-hidden ${inRoute ? 'opacity-50' : ''}`}
              >
                {/* Ordre-header */}
                <div className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-gray-900 truncate">{o.customerName}</div>
                      <div className="text-xs text-gray-500">{o.number}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {o.status}
                    </span>
                  </div>
                  {o.shipToAddress && (
                    <div className="text-xs text-gray-500">{o.shipToAddress}, {o.shipToPostCode} {o.shipToCity}</div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {o.requestedDeliveryDate && (
                      <span className="text-xs text-gray-400">📅 {o.requestedDeliveryDate}</span>
                    )}
                    {o.deliveryCodes.map(code => (
                      <span key={code} className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-mono text-purple-700">{code}</span>
                    ))}
                  </div>
                  {/* Tildel til bil */}
                  {!inRoute && (
                    <div className="flex gap-1 flex-wrap pt-1">
                      {vehicles.map((v, vi) => (
                        <button key={v._key} onClick={() => addOrder(vi, o)}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">
                          + {v.vehicleLabel}
                        </button>
                      ))}
                    </div>
                  )}
                  {inRoute && (
                    <div className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle2 size={12} /> Tilføjet til rute
                    </div>
                  )}
                </div>

                {/* Varelinjer — toggle */}
                {o.lines.length > 0 && (
                  <>
                    <button
                      onClick={() => toggleOrderExpand(o.id)}
                      className="w-full flex items-center justify-between border-t border-gray-100 px-4 py-2 text-xs text-gray-500 hover:bg-gray-50"
                    >
                      <span>
                        {checkedCount > 0
                          ? `${checkedCount}/${o.lines.length} pakket`
                          : `${o.lines.length} varelinje${o.lines.length !== 1 ? 'r' : ''}`}
                      </span>
                      {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                    {expanded && (
                      <div className="border-t border-gray-100 divide-y divide-gray-50">
                        {o.lines.map(line => {
                          const checked = checkedLines.has(line.id)
                          return (
                            <label key={line.id}
                              className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 ${checked ? 'bg-green-50' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleLine(line.id)}
                                className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-green-600"
                              />
                              <div className="min-w-0">
                                <div className={`text-xs font-medium ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                  {line.description}
                                </div>
                                <div className="text-xs text-gray-400 font-mono">
                                  {line.itemNo} · {line.quantity} {line.uom}
                                </div>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Højre: Biler + ruter ───────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Ruteplan</h2>
            <button onClick={addVehicle}
              className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
              <Plus size={13} /> Tilføj bil
            </button>
          </div>

          {vehicles.map((v, vi) => (
            <div key={v._key} className="rounded-xl bg-white ring-1 ring-gray-200">
              {/* Bil-header */}
              <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
                <Truck size={16} className="text-blue-600 shrink-0" />
                <input value={v.vehicleLabel}
                  onChange={e => updateVehicle(vi, { vehicleLabel: e.target.value })}
                  className="flex-1 text-sm font-semibold text-gray-900 bg-transparent focus:outline-none focus:border-b focus:border-blue-400"
                  placeholder="Bil 1" />
                <select value={v.driverId} onChange={e => updateVehicle(vi, { driverId: e.target.value })}
                  className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 bg-white focus:border-blue-400 focus:outline-none">
                  <option value="">— Vælg chauffør —</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.isDefault ? '⭐ ' : ''}{d.name}
                    </option>
                  ))}
                </select>
                {totalKg(v) > 0 && (
                  <span className="shrink-0 text-xs text-gray-500 font-medium">{totalKg(v).toFixed(1)} kg</span>
                )}
              </div>

              {/* Stops */}
              <div className="divide-y divide-gray-50">
                {v.stops.length === 0 && (
                  <p className="px-4 py-3 text-xs text-gray-400 italic">Ingen stops — tilføj ordrer fra listen til venstre</p>
                )}
                {v.stops.map((s, si) => (
                  <div key={s._key}
                    draggable
                    onDragStart={() => onDragStart(vi, si)}
                    onDragOver={onDragOver}
                    onDrop={() => onDrop(vi, si)}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-grab"
                  >
                    <GripVertical size={14} className="mt-0.5 shrink-0 text-gray-300" />
                    <span className="mt-0.5 shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold">{si + 1}</span>

                    <div className="flex-1 min-w-0 space-y-1">
                      {s.isExtraTask ? (
                        <>
                          <input value={s.extraTaskTitle ?? ''}
                            onChange={e => updateStop(vi, si, { extraTaskTitle: e.target.value })}
                            className="w-full text-sm font-medium text-gray-900 bg-transparent focus:outline-none border-b border-transparent focus:border-blue-400"
                            placeholder="Ekstra opgave (beskrivelse)" />
                          <input value={s.extraTaskNote ?? ''}
                            onChange={e => updateStop(vi, si, { extraTaskNote: e.target.value })}
                            className="w-full text-xs text-gray-500 bg-transparent focus:outline-none border-b border-transparent focus:border-blue-400"
                            placeholder="Detaljer…" />
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{s.customerName ?? s.bcSalesOrderNo}</span>
                            {s.bcSalesOrderNo && (
                              <span className="text-xs text-gray-400 font-mono">{s.bcSalesOrderNo}</span>
                            )}
                            {s.packedStatus === 'PENDING' && (
                              <span className="flex items-center gap-0.5 text-xs text-amber-600"><Clock size={10} /> Mangler pakning</span>
                            )}
                            {s.packedStatus === 'READY' && (
                              <span className="flex items-center gap-0.5 text-xs text-green-600"><CheckCircle2 size={10} /> Pakket</span>
                            )}
                          </div>
                          {s.customerAddress && <div className="text-xs text-gray-500">{s.customerAddress}</div>}
                          {s.totalWeightKg ? <div className="text-xs text-gray-400">{s.totalWeightKg} kg</div> : null}
                        </>
                      )}

                      {/* Per-stop chauffør (hvis anderledes end bilens) */}
                      <select value={s.driverId ?? ''}
                        onChange={e => updateStop(vi, si, { driverId: e.target.value || undefined })}
                        className="text-xs text-gray-500 bg-transparent focus:outline-none border-b border-transparent focus:border-blue-400">
                        <option value="">Brug bilens chauffør</option>
                        {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>

                    <button onClick={() => removeStop(vi, si)}
                      className="shrink-0 rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Tilføj ekstra opgave */}
              <div className="border-t border-gray-100 px-4 py-2">
                <button onClick={() => addExtraTask(vi)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600">
                  <Plus size={12} /> Ekstra opgave
                </button>
              </div>
            </div>
          ))}

          {/* Noter til hele ruten */}
          <div className="rounded-xl bg-white ring-1 ring-gray-200 p-4">
            <label className="mb-1.5 block text-xs font-medium text-gray-600">Generelle noter til ruten</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none resize-none"
              placeholder="F.eks. ekstra kørsel, særlige instrukser…" />
          </div>
        </div>
      </div>
    </div>
  )
}
