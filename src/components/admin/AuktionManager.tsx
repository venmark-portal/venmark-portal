'use client'

import { useCallback, useEffect, useState } from 'react'

type Status = 'DRAFT' | 'LIVE' | 'ENDED' | 'CANCELLED'
interface AuctionRow {
  id: string; title: string; status: Status; priceMode: 'TOTAL' | 'PER_KG'
  minPrice: number; currentPrice: number; leaderName: string | null; bidCount: number
  startsAt: string; endsAt: string; images: number
}
interface ImgUp { data: string; mimeType: string }

const STATUS_LABEL: Record<Status, string> = { DRAFT: 'Kladde', LIVE: 'Live', ENDED: 'Afsluttet', CANCELLED: 'Aflyst' }
const STATUS_STYLE: Record<Status, string> = {
  DRAFT: 'bg-gray-100 text-gray-600', LIVE: 'bg-green-100 text-green-700',
  ENDED: 'bg-blue-100 text-blue-700', CANCELLED: 'bg-red-100 text-red-600',
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

// Default udløb = om 1 time, i lokal datetime-local-format.
function defaultEnds(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AuktionManager() {
  const [auctions, setAuctions] = useState<AuctionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)

  // Formular
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [lotText, setLotText] = useState('')
  const [itemNo, setItemNo] = useState('')
  const [priceMode, setPriceMode] = useState<'TOTAL' | 'PER_KG'>('TOTAL')
  const [minPrice, setMinPrice] = useState('')
  const [endsAt, setEndsAt] = useState(defaultEnds())
  const [images, setImages] = useState<ImgUp[]>([])
  const [startNow, setStartNow] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/auktioner', { cache: 'no-store' })
      const d = await r.json()
      setAuctions(Array.isArray(d.auctions) ? d.auctions : [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onFiles = async (files: FileList | null) => {
    if (!files) return
    const room = 3 - images.length
    const picked = Array.from(files).slice(0, Math.max(0, room))
    const ups: ImgUp[] = []
    for (const f of picked) {
      try { ups.push({ data: await fileToDataUrl(f), mimeType: f.type || 'image/jpeg' }) } catch { /* ignore */ }
    }
    setImages((prev) => [...prev, ...ups].slice(0, 3))
  }

  const resetForm = () => {
    setTitle(''); setDescription(''); setLotText(''); setItemNo('')
    setPriceMode('TOTAL'); setMinPrice(''); setEndsAt(defaultEnds()); setImages([]); setStartNow(true)
  }

  const create = async () => {
    setError('')
    if (!title.trim()) { setError('Titel mangler.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/admin/auktioner', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, description, lotText, itemNo, priceMode,
          minPrice: Number(minPrice) || 0,
          endsAt: new Date(endsAt).toISOString(),
          images, startNow,
        }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d?.error ?? 'Kunne ikke oprette.'); setBusy(false); return }
      resetForm(); setShowForm(false); await load()
    } catch { setError('Serverfejl.') }
    setBusy(false)
  }

  const action = async (id: string, act: 'start' | 'cancel' | 'end') => {
    if (act === 'cancel' && !confirm('Aflys auktionen?')) return
    setBusy(true)
    try {
      await fetch(`/api/admin/auktioner/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act }),
      })
      await load()
    } catch { /* ignore */ }
    setBusy(false)
  }

  const del = async (id: string) => {
    if (!confirm('Slet auktionen permanent?')) return
    setBusy(true)
    try { await fetch(`/api/admin/auktioner/${id}`, { method: 'DELETE' }); await load() } catch { /* ignore */ }
    setBusy(false)
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString('da-DK', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-6">
      <button
        onClick={() => { setShowForm((v) => !v); setError('') }}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        {showForm ? 'Luk' : '+ Ny auktion'}
      </button>

      {showForm && (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel (fx Pighvar, dagsfangst)"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Beskrivelse" rows={3}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <input value={lotText} onChange={(e) => setLotText(e.target.value)} placeholder="Mængde/lot (fri tekst)"
              className="rounded border border-gray-300 px-3 py-2 text-sm" />
            <input value={itemNo} onChange={(e) => setItemNo(e.target.value)} placeholder="BC-varenr. (valgfri)"
              className="rounded border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-gray-600">Prismodel
              <select value={priceMode} onChange={(e) => setPriceMode(e.target.value as any)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm">
                <option value="TOTAL">Totalpris (parti)</option>
                <option value="PER_KG">Pris pr. kg</option>
              </select>
            </label>
            <label className="text-sm text-gray-600">Minimumspris (reserve)
              <input type="number" min={0} value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="0"
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="block text-sm text-gray-600">Udløbstid
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          </label>

          <div>
            <div className="mb-1 text-sm text-gray-600">Billeder (op til 3 — upload eller kamera)</div>
            <div className="flex flex-wrap gap-2">
              {images.map((im, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.data} alt="" className="h-20 w-20 rounded object-cover" />
                  <button onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                    className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-red-600 text-xs font-bold text-white">×</button>
                </div>
              ))}
              {images.length < 3 && (
                <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded border-2 border-dashed border-gray-300 text-2xl text-gray-400 hover:border-blue-400">
                  +
                  <input type="file" accept="image/*" capture="environment" multiple className="hidden"
                    onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
                </label>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
            Start auktionen med det samme (ellers gemmes som kladde)
          </label>

          <button onClick={create} disabled={busy}
            className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50">
            {busy ? 'Opretter…' : 'Opret auktion'}
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400">Henter…</div>
        ) : auctions.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">Ingen auktioner endnu.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Titel</th><th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Bud</th><th className="px-3 py-2">Højeste</th>
                <th className="px-3 py-2">Fører</th><th className="px-3 py-2">Udløber</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {auctions.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2 font-medium text-gray-800">{a.title}
                    <span className="ml-1 text-xs text-gray-400">{a.priceMode === 'PER_KG' ? 'kr/kg' : 'total'}</span>
                  </td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span></td>
                  <td className="px-3 py-2">{a.bidCount}</td>
                  <td className="px-3 py-2 font-semibold">{a.currentPrice > 0 ? `${a.currentPrice} kr` : '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{a.leaderName ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{fmt(a.endsAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {a.status === 'DRAFT' && <button onClick={() => action(a.id, 'start')} disabled={busy} className="rounded bg-green-600 px-2 py-1 text-xs text-white">Start</button>}
                      {a.status === 'LIVE' && <button onClick={() => action(a.id, 'end')} disabled={busy} className="rounded bg-blue-600 px-2 py-1 text-xs text-white">Afslut nu</button>}
                      {(a.status === 'DRAFT' || a.status === 'LIVE') && <button onClick={() => action(a.id, 'cancel')} disabled={busy} className="rounded bg-red-500 px-2 py-1 text-xs text-white">Aflys</button>}
                      {(a.status === 'DRAFT' || a.status === 'CANCELLED') && <button onClick={() => del(a.id)} disabled={busy} className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-600">Slet</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
