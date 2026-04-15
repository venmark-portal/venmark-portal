'use client'

import { useState } from 'react'
import { Search, Camera, X } from 'lucide-react'

interface BoxPhotoRecord {
  id: string
  bcBoxEntryNo: number
  filePath: string
  takenAt: string
  bcSalesOrderNo: string | null
  bcCustomerNo: string | null
  boxWeight: number | null
  itemNo: string | null
}

export default function KassefotoPage() {
  const [query, setQuery]       = useState('')
  const [photos, setPhotos]     = useState<BoxPhotoRecord[]>([])
  const [loading, setLoading]   = useState(false)
  const [searched, setSearched] = useState(false)
  const [fullImg, setFullImg]   = useState<string | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setSearched(true)

    try {
      // Søg altid på begge — ordrenummer kan også være et rent tal (f.eks. 265803)
      const byOrder = fetch(`/api/foto/ordre?salesOrderNo=${encodeURIComponent(q)}`)
        .then(r => r.ok ? r.json() : []).catch(() => [])
      const byEntry = /^\d+$/.test(q)
        ? fetch(`/api/foto/kasse?entryNo=${encodeURIComponent(q)}`)
            .then(r => r.ok ? r.json() : []).catch(() => [])
        : Promise.resolve([])

      const [fromOrder, fromEntry] = await Promise.all([byOrder, byEntry])
      // Slå sammen, undgå dubletter på id
      const seen = new Set<string>()
      const combined = [...(Array.isArray(fromOrder) ? fromOrder : []), ...(Array.isArray(fromEntry) ? fromEntry : [])]
        .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true })
      setPhotos(combined)
    } catch {
      setPhotos([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Kassefoto</h1>
        <p className="mt-1 text-sm text-gray-500">
          Søg på salgsordrenummer (f.eks. S00123) eller kassens entry no. (heltal)
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Salgsordrenr. eller kassesnr."
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Search size={15} />
          {loading ? 'Søger…' : 'Søg'}
        </button>
      </form>

      {searched && !loading && photos.length === 0 && (
        <div className="rounded-xl bg-white p-10 text-center text-sm text-gray-400 ring-1 ring-gray-200">
          <Camera size={32} className="mx-auto mb-2 text-gray-300" />
          Ingen fotos fundet
        </div>
      )}

      {photos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">{photos.length} foto{photos.length !== 1 ? 's' : ''}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {photos.map(p => (
              <button
                key={p.id}
                onClick={() => setFullImg(`/api/foto/thumb?entryNo=${p.bcBoxEntryNo}`)}
                className="group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm hover:border-blue-300 hover:shadow-md transition text-left"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/foto/thumb?entryNo=${p.bcBoxEntryNo}`}
                  alt=""
                  className="h-36 w-full object-cover group-hover:opacity-90 transition"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
                <div className="p-2 space-y-0.5">
                  <p className="text-xs font-mono text-gray-500">#{p.bcBoxEntryNo}</p>
                  {p.bcSalesOrderNo && (
                    <p className="text-xs text-gray-700 font-medium truncate">{p.bcSalesOrderNo}</p>
                  )}
                  {p.boxWeight && (
                    <p className="text-xs text-gray-400">{p.boxWeight} kg</p>
                  )}
                  <p className="text-[10px] text-gray-400">
                    {new Date(p.takenAt).toLocaleString('da-DK', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fuldskærms-visning */}
      {fullImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setFullImg(null)}
        >
          <button
            onClick={() => setFullImg(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fullImg}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
