'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, CheckCircle2, XCircle, MapPin, Camera } from 'lucide-react'

interface DeliveryRow {
  stopId:               string
  bcSalesOrderNo:       string | null
  customerName:         string | null
  customerAddress:      string | null
  deliveryCodeOverride: string | null
  totalWeightKg:        number | null
  deliveredAt:          string | null
  failureNote:          string | null
  status:               string
  vehicleLabel:         string
  bookingDate:          string
  photoLat:             number | null
  photoLng:             number | null
  photoTakenAt:         string | null
  hasPhoto:             boolean
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('da-DK', {
    weekday: 'short', day: 'numeric', month: 'short',
    timeZone: 'Europe/Copenhagen',
  })
}

function fmtTime(iso: string | null): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleTimeString('da-DK', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Europe/Copenhagen',
  })
}

export default function LeveringshistorikPage() {
  const [rows,    setRows]    = useState<DeliveryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [from,    setFrom]    = useState('')
  const [to,      setTo]      = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (from)          params.set('from', from)
    if (to)            params.set('to', to)
    const res = await fetch(`/api/admin/leveringshistorik?${params}`)
    setRows(await res.json())
    setLoading(false)
  }, [search, from, to])

  useEffect(() => { load() }, [load])

  const delivered = rows.filter(r => r.status === 'DELIVERED').length
  const failed    = rows.filter(r => r.status === 'FAILED').length
  const withPhoto = rows.filter(r => r.hasPhoto).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Leveringshistorik</h1>
        <p className="mt-1 text-sm text-gray-500">De 100 seneste afsluttede leveringer</p>
      </div>

      {/* Søgeformular */}
      <form onSubmit={e => { e.preventDefault(); load() }}
        className="rounded-xl bg-white p-4 ring-1 ring-gray-200 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-gray-600 mb-1">Kunde</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Søg på kundenavn…"
              className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Fra dato</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Til dato</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        </div>
        <button type="submit" disabled={loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Søger…' : 'Søg'}
        </button>
        {(search || from || to) && (
          <button type="button" onClick={() => { setSearch(''); setFrom(''); setTo('') }}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Nulstil
          </button>
        )}
      </form>

      {/* Statistik */}
      {!loading && rows.length > 0 && (
        <div className="flex gap-4 text-sm text-gray-500 flex-wrap">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-green-600" /> {delivered} leveret
          </span>
          {failed > 0 && (
            <span className="flex items-center gap-1.5">
              <XCircle size={14} className="text-red-500" /> {failed} fejlet
            </span>
          )}
          {withPhoto > 0 && (
            <span className="flex items-center gap-1.5">
              <Camera size={14} className="text-blue-500" /> {withPhoto} med foto
            </span>
          )}
          <span className="text-gray-400">{rows.length} vist</span>
        </div>
      )}

      {/* Tabel */}
      {loading ? (
        <div className="text-center py-12 text-sm text-gray-400">Henter…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-white p-12 text-center ring-1 ring-gray-200 text-sm text-gray-400">
          Ingen leveringer fundet
        </div>
      ) : (
        <div className="rounded-xl bg-white ring-1 ring-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Dato</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Tid</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Kunde</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Adresse</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Ordre</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell whitespace-nowrap">Kode / Bil</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Foto / Geo</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.stopId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap text-sm">
                    {fmtDate(r.bookingDate)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-sm">
                    {fmtTime(r.deliveredAt)}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {r.customerName ?? '–'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell text-xs max-w-48 truncate">
                    {r.customerAddress ?? '–'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs hidden lg:table-cell whitespace-nowrap">
                    {r.bcSalesOrderNo ?? '–'}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex flex-col gap-0.5">
                      {r.deliveryCodeOverride && (
                        <span className="text-xs font-medium text-blue-600">{r.deliveryCodeOverride}</span>
                      )}
                      <span className="text-xs text-gray-400">{r.vehicleLabel}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {r.hasPhoto ? (
                        <div className="relative group inline-block">
                          <a
                            href={`/api/chauffeur/stop/${r.stopId}/photo`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-100"
                          >
                            <Camera size={11} />
                            Foto {r.photoTakenAt ? fmtTime(r.photoTakenAt) : ''}
                          </a>
                          {/* Forhåndsvisning ved hover */}
                          <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-50 shadow-xl rounded-lg overflow-hidden border border-gray-200">
                            <img
                              src={`/api/chauffeur/stop/${r.stopId}/photo`}
                              alt="Leveringsfoto"
                              className="w-56 h-56 object-cover"
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">Intet foto</span>
                      )}
                      {r.photoLat && r.photoLng ? (
                        <a
                          href={`https://www.google.com/maps?q=${r.photoLat},${r.photoLng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600"
                        >
                          <MapPin size={10} className="shrink-0" />
                          {r.photoLat.toFixed(5)}, {r.photoLng.toFixed(5)}
                        </a>
                      ) : r.hasPhoto ? (
                        <span className="text-xs text-gray-300 flex items-center gap-1">
                          <MapPin size={10} /> Ingen GPS
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'DELIVERED' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                        <CheckCircle2 size={11} /> Leveret
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700" title={r.failureNote ?? ''}>
                        <XCircle size={11} /> Fejlet
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
