'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import {
  Truck, MapPin, Phone, Package, CheckCircle2, XCircle,
  Clock, ChevronDown, ChevronUp, LogOut, AlertTriangle,
  Camera, Navigation, ChevronLeft, ChevronRight,
} from 'lucide-react'

function defaultDate(): string {
  const now = new Date()
  const cphToday = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Copenhagen' })
  const cphHour  = parseInt(now.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hour12: false }))
  if (cphHour >= 15) {
    const d = new Date(cphToday + 'T12:00:00')
    do { d.setDate(d.getDate() + 1) } while (d.getDay() === 0 || d.getDay() === 6)
    return d.toISOString().slice(0, 10)
  }
  return cphToday
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

interface Stop {
  id:              string
  sortOrder:       number
  bcSalesOrderNo:  string | null
  isExtraTask:     boolean
  extraTaskTitle:  string | null
  extraTaskNote:   string | null
  customerName:    string | null
  customerAddress: string | null
  customerPhone:   string | null
  totalWeightKg:   number | null
  status:          'PENDING' | 'DELIVERED' | 'FAILED' | 'SKIPPED'
  deliveredAt:     string | null
  failureNote:     string | null
  packedStatus:    string | null
}

interface Vehicle {
  vehicleId:    string
  vehicleLabel: string
  stops:        Stop[]
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  PENDING:   <Clock        size={16} className="text-amber-500" />,
  DELIVERED: <CheckCircle2 size={16} className="text-green-600" />,
  FAILED:    <XCircle      size={16} className="text-red-500" />,
  SKIPPED:   <AlertTriangle size={16} className="text-gray-400" />,
}

const STATUS_LABEL: Record<string, string> = {
  PENDING:   'Afventer',
  DELIVERED: 'Leveret',
  FAILED:    'Fejlet',
  SKIPPED:   'Sprunget over',
}

export default function ChauffeurRutePage() {
  const { data: session } = useSession()
  const [vehicles,    setVehicles]    = useState<Vehicle[]>([])
  const [notes,       setNotes]       = useState('')
  const [date,        setDate]        = useState(() => defaultDate())
  const [loading,     setLoading]     = useState(true)
  const [preliminary, setPreliminary] = useState(false)
  const [expanded,  setExpanded]  = useState<Set<string>>(new Set())
  const [updating,  setUpdating]  = useState<Set<string>>(new Set())
  const [failNotes, setFailNotes] = useState<Record<string, string>>({})
  const fileInputRefs = useRef<Record<string, HTMLInputElement>>({})

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setVehicles([])
    const res  = await fetch(`/api/chauffeur/rute?date=${d}`)
    const data = await res.json()
    setVehicles(data.vehicles ?? [])
    setNotes(data.notes ?? '')
    setPreliminary(data.preliminary ?? false)
    setLoading(false)
  }, [])

  useEffect(() => { load(date) }, [load, date])

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  async function uploadPhoto(stopId: string, file: File) {
    setUpdating(prev => new Set(prev).add(stopId))
    let lat = 0, lng = 0
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch {}
    const fd = new FormData()
    fd.append('photo', file)
    fd.append('lat', String(lat))
    fd.append('lng', String(lng))
    await fetch(`/api/chauffeur/stop/${stopId}/photo`, { method: 'POST', body: fd })
    setVehicles(vs => vs.map(v => ({
      ...v,
      stops: v.stops.map(s => s.id !== stopId ? s : {
        ...s,
        status:      'DELIVERED' as any,
        deliveredAt: new Date().toISOString(),
      }),
    })))
    setUpdating(prev => { const n = new Set(prev); n.delete(stopId); return n })
  }

  async function updateStop(stopId: string, status: string, failureNote?: string) {
    setUpdating(prev => new Set(prev).add(stopId))
    await fetch(`/api/chauffeur/stop/${stopId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status, failureNote }),
    })
    // Opdater lokalt
    setVehicles(vs => vs.map(v => ({
      ...v,
      stops: v.stops.map(s => s.id !== stopId ? s : {
        ...s,
        status:     status as any,
        deliveredAt: status === 'DELIVERED' ? new Date().toISOString() : s.deliveredAt,
        failureNote: failureNote ?? s.failureNote,
      }),
    })))
    setUpdating(prev => { const n = new Set(prev); n.delete(stopId); return n })
  }

  const allStops    = vehicles.flatMap(v => v.stops)
  const delivered   = allStops.filter(s => s.status === 'DELIVERED').length
  const total       = allStops.length

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">
      Henter rute…
    </div>
  )

  const dkDate = date
    ? new Date(date + 'T12:00:00').toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' })
    : ''

  return (
    <div className="mx-auto max-w-lg px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1">
            <Truck size={20} className="text-blue-600 mr-1" />
            <button onClick={() => setDate(d => addDays(d, -1))} className="p-1 rounded hover:bg-gray-100">
              <ChevronLeft size={16} className="text-gray-400" />
            </button>
            <label className="text-base font-bold text-gray-900 capitalize cursor-pointer">
              {dkDate}
              <input
                type="date"
                value={date}
                onChange={e => e.target.value && setDate(e.target.value)}
                className="absolute opacity-0 w-0 h-0"
              />
            </label>
            <button onClick={() => setDate(d => addDays(d, 1))} className="p-1 rounded hover:bg-gray-100">
              <ChevronRight size={16} className="text-gray-400" />
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {session?.user?.name} · {delivered}/{total} leveret
          </p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/chauffeur/login' })}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
        >
          <LogOut size={13} /> Log ud
        </button>
      </div>

      {/* Fremgangsbar */}
      {total > 0 && (
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <div className="mb-2 flex justify-between text-xs text-gray-500">
            <span>Fremgang</span>
            <span>{delivered} / {total} stop</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-gray-100">
            <div
              className="h-2.5 rounded-full bg-green-500 transition-all"
              style={{ width: total > 0 ? `${(delivered / total) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* Foreløbig rute */}
      {preliminary && (
        <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200 text-sm text-amber-800">
          Foreløbig rute — ikke endeligt planlagt af admin endnu
        </div>
      )}

      {/* Generelle noter */}
      {notes && (
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200 text-sm text-amber-800">
          <div className="font-semibold mb-1">Note til ruten</div>
          {notes}
        </div>
      )}

      {/* Ingen rute */}
      {vehicles.length === 0 && !preliminary && (
        <div className="rounded-xl bg-white p-8 text-center ring-1 ring-gray-200 text-sm text-gray-400">
          Ingen rute planlagt for {dkDate || date}
        </div>
      )}
      {vehicles.length === 0 && preliminary && (
        <div className="rounded-xl bg-white p-8 text-center ring-1 ring-gray-200 text-sm text-gray-400">
          Ingen ordrer fundet i BC for {dkDate || date}
        </div>
      )}

      {/* Biler + stops */}
      {vehicles.map(v => (
        <div key={v.vehicleId} className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Truck size={14} className="text-blue-600" />
            <span className="text-sm font-semibold text-gray-700">{v.vehicleLabel}</span>
          </div>

          {v.stops.map((s, idx) => {
            const isExpanded  = expanded.has(s.id)
            const isUpdating  = updating.has(s.id)
            const isDone      = s.status !== 'PENDING'
            const showFailBox = isExpanded && s.status === 'PENDING'
            const isPrelim    = s.id.startsWith('bc-')

            return (
              <div key={s.id}
                className={`rounded-2xl bg-white ring-1 transition-all ${
                  s.status === 'DELIVERED' ? 'ring-green-200 bg-green-50' :
                  s.status === 'FAILED'    ? 'ring-red-200 bg-red-50' :
                  'ring-gray-200'
                }`}
              >
                {/* Stop-header */}
                <button
                  onClick={() => toggleExpand(s.id)}
                  className="w-full flex items-start gap-3 p-4 text-left"
                >
                  {/* Stop-nummer */}
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                    {idx + 1}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900 truncate">
                        {s.isExtraTask ? (s.extraTaskTitle || 'Ekstra opgave') : (s.customerName ?? s.bcSalesOrderNo ?? '–')}
                      </span>
                      {STATUS_ICON[s.status]}
                    </div>
                    {!s.isExtraTask && s.customerAddress && (
                      <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                        <MapPin size={10} /> {s.customerAddress}
                      </div>
                    )}
                    {s.isExtraTask && s.extraTaskNote && (
                      <div className="text-xs text-gray-500 mt-0.5">{s.extraTaskNote}</div>
                    )}
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                      {s.bcSalesOrderNo && <span className="font-mono">{s.bcSalesOrderNo}</span>}
                      {s.totalWeightKg  && <span>{s.totalWeightKg} kg</span>}
                      {s.packedStatus === 'READY' && (
                        <span className="text-green-600 font-medium">✓ Pakket</span>
                      )}
                      <span className="ml-auto text-gray-400">{STATUS_LABEL[s.status]}</span>
                    </div>
                  </div>

                  {isExpanded ? <ChevronUp size={16} className="shrink-0 text-gray-400 mt-1" /> : <ChevronDown size={16} className="shrink-0 text-gray-400 mt-1" />}
                </button>

                {/* Udvidet indhold */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
                    {/* Telefon + Maps */}
                    <div className="flex items-center gap-3">
                      {s.customerPhone && (
                        <a href={`tel:${s.customerPhone}`}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                          <Phone size={14} /> {s.customerPhone}
                        </a>
                      )}
                      {s.customerAddress && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.customerAddress)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          <Navigation size={13} /> Navigér
                        </a>
                      )}
                    </div>

                    {/* Fejlnote (til FAILED) */}
                    {showFailBox && (
                      <textarea
                        placeholder="Beskriv problemet (valgfrit)…"
                        value={failNotes[s.id] ?? ''}
                        onChange={e => setFailNotes(prev => ({ ...prev, [s.id]: e.target.value }))}
                        rows={2}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none resize-none"
                      />
                    )}

                    {/* Handlinger */}
                    {isPrelim ? (
                      <div className="text-xs text-amber-600 text-center py-1">Ruten er ikke endeligt planlagt endnu</div>
                    ) : !isDone ? (
                      <div className="flex gap-2">
                        {/* Skjult fil-input til kamera */}
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          ref={el => { if (el) fileInputRefs.current[s.id] = el }}
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (file) uploadPhoto(s.id, file)
                          }}
                        />
                        <button
                          onClick={() => fileInputRefs.current[s.id]?.click()}
                          disabled={isUpdating}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-green-600 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          <Camera size={15} /> {isUpdating ? 'Gemmer…' : 'Leveret'}
                        </button>
                        <button
                          onClick={() => updateStop(s.id, 'FAILED', failNotes[s.id])}
                          disabled={isUpdating}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-red-300 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          <XCircle size={15} /> Fejlet
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => updateStop(s.id, 'PENDING')}
                        disabled={isUpdating}
                        className="text-xs text-gray-400 hover:text-gray-600 underline"
                      >
                        Fortryd
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {/* Alle leveret */}
      {total > 0 && delivered === total && (
        <div className="rounded-2xl bg-green-600 p-6 text-center text-white">
          <CheckCircle2 size={32} className="mx-auto mb-2" />
          <div className="font-bold text-lg">Alle stop leveret!</div>
          <div className="text-sm opacity-80 mt-1">God arbejdsindsats i dag</div>
        </div>
      )}
    </div>
  )
}
