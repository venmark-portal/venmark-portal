'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, X, ShoppingCart, Tag, Filter, Heart, Minus, Plus } from 'lucide-react'
import type { BCItem, BCItemCategory } from '@/lib/businesscentral'

type EnrichedItem = BCItem & { unitPrice: number }

interface Props {
  onAddItems:   (items: { item: EnrichedItem; quantity: number }[]) => void
  onClose:      () => void
  favNos:       Set<string>
  onToggleFav:  (item: EnrichedItem) => void
}

export default function ItemSearchModal({ onAddItems, onClose, favNos, onToggleFav }: Props) {
  const [query,      setQuery]      = useState('')
  const [results,    setResults]    = useState<EnrichedItem[]>([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [categories, setCategories] = useState<BCItemCategory[]>([])
  const [selCat,     setSelCat]     = useState<string | null>(null)
  const [showCats,   setShowCats]   = useState(false)
  const [quantities, setQuantities] = useState<Map<string, number>>(new Map())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    fetch('/api/products/categories')
      .then(r => r.json())
      .then(cats => Array.isArray(cats) ? setCategories(cats) : null)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const hasQuery = query.trim().length >= 2
    const hasCat   = !!selCat
    if (!hasQuery && !hasCat) { setResults([]); setError(''); return }

    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ top: '30' })
        if (query.trim().length >= 2) params.set('search', query.trim())
        if (selCat) params.set('category', selCat)
        const res  = await fetch(`/api/products?${params}`)
        const data = await res.json()
        if (!res.ok || data.error) {
          setError(data.error ?? `Fejl fra server (${res.status})`)
          setResults([])
        } else {
          setResults(data.value ?? [])
        }
      } catch {
        setError('Kunne ikke nå serveren — prøv igen')
        setResults([])
      } finally {
        setLoading(false)
      }
    }, query.trim().length >= 2 ? 350 : 0)

    return () => clearTimeout(timer)
  }, [query, selCat])

  function setQty(itemNo: string, qty: number) {
    setQuantities(prev => {
      const next = new Map(prev)
      if (qty <= 0) next.delete(itemNo)
      else next.set(itemNo, qty)
      return next
    })
  }

  function handleAdd() {
    const toAdd = results
      .filter(r => (quantities.get(r.number) ?? 0) > 0)
      .map(r => ({ item: r, quantity: quantities.get(r.number)! }))
    if (toAdd.length === 0) return
    onAddItems(toAdd)
    onClose()
  }

  const fmt = new Intl.NumberFormat('da-DK', {
    style: 'currency', currency: 'DKK', minimumFractionDigits: 2,
  })

  const selectedCatLabel = selCat
    ? (categories.find(c => c.code === selCat)?.displayName ?? selCat)
    : null

  const itemsWithQty = results.filter(r => (quantities.get(r.number) ?? 0) > 0).length

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
      <div className="w-full max-w-lg rounded-t-2xl bg-white shadow-xl md:rounded-2xl flex flex-col max-h-[90vh]">

        {/* ── Søgelinje ── */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 shrink-0">
          <Search size={18} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Søg på varenummer eller navn…"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-gray-400"
          />
          <button
            onClick={() => setShowCats(v => !v)}
            className={`rounded-full p-1.5 transition-colors ${showCats || selCat ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-400'}`}
            title="Filtrer på kategori"
          >
            <Filter size={16} />
          </button>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* ── Kategori-filter ── */}
        {showCats && (
          <div className="border-b border-gray-100 px-4 py-3 shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Kategori</p>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              <button
                onClick={() => setSelCat(null)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  !selCat ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Alle
              </button>
              {categories.map(cat => (
                <button
                  key={cat.code}
                  onClick={() => setSelCat(c => c === cat.code ? null : cat.code)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    selCat === cat.code ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {cat.displayName}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Aktiv filter-chip */}
        {selCat && !showCats && (
          <div className="px-4 py-2 border-b border-gray-100 shrink-0 flex items-center gap-2">
            <span className="text-xs text-gray-500">Kategori:</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              <Tag size={10} />
              {selectedCatLabel}
              <button onClick={() => setSelCat(null)} className="ml-0.5 hover:text-blue-900">
                <X size={10} />
              </button>
            </span>
          </div>
        )}

        {/* ── Resultater ── */}
        <div className="overflow-y-auto flex-1">
          {loading && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">Søger…</div>
          )}
          {!loading && error && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-red-600 font-medium">Søgning fejlede</p>
              <p className="text-xs text-gray-400 mt-1">{error}</p>
            </div>
          )}
          {!loading && !error && !selCat && query.trim().length < 2 && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              Skriv mindst 2 tegn, eller vælg en kategori via <Filter size={13} className="inline" />
            </div>
          )}
          {!loading && !error && results.length === 0 && (query.trim().length >= 2 || selCat) && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              Ingen varer fundet
              {query.trim().length >= 2 && <> for &quot;{query}&quot;</>}
              {selCat && <> i {selectedCatLabel}</>}
            </div>
          )}

          {results.map((item) => {
            const picUrl = item.picture?.id
              ? `/api/portal/item-image/${item.id}?pictureId=${item.picture.id}`
              : null
            const qty    = quantities.get(item.number) ?? 0
            const isFav  = favNos.has(item.number)

            return (
              <div
                key={item.id}
                className={`px-3 py-2 border-b border-gray-50 last:border-0 transition-colors ${qty > 0 ? 'bg-blue-50/50' : ''}`}
              >
                {/* Øverste række: billede + navn + hjerte */}
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="h-8 w-8 shrink-0 rounded-md overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center">
                    {picUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={picUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ShoppingCart size={14} className="text-gray-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900">{item.displayName}</div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                      <span className="font-mono">{item.number}</span>
                      {item.unitPrice > 0 && (
                        <><span>·</span>
                        <span className="font-semibold text-gray-600">{fmt.format(item.unitPrice)}/{item.baseUnitOfMeasureCode}</span></>
                      )}
                    </div>
                  </div>
                  {/* Hjerte */}
                  <button
                    onClick={() => onToggleFav(item as EnrichedItem)}
                    className={`shrink-0 p-1 rounded-full transition-colors ${
                      isFav ? 'text-red-400 hover:text-red-300' : 'text-gray-200 hover:text-red-300'
                    }`}
                    title={isFav ? 'Fjern favorit' : 'Tilføj favorit'}
                  >
                    <Heart size={15} fill={isFav ? 'currentColor' : 'none'} />
                  </button>
                </div>

                {/* Nedre række: antal-knapper */}
                <div className="flex items-center gap-1 justify-end">
                  <button
                    onClick={() => setQty(item.number, Math.max(0, qty - 1))}
                    disabled={qty === 0}
                    className="h-7 w-7 flex items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-25 active:scale-95 transition"
                  >
                    <Minus size={12} />
                  </button>
                  <input
                    type="number"
                    min={0}
                    value={qty || ''}
                    placeholder="0"
                    onChange={(e) => setQty(item.number, Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-10 rounded border border-gray-200 py-1 text-center text-sm font-semibold focus:border-blue-400 focus:outline-none"
                  />
                  <button
                    onClick={() => setQty(item.number, qty + 1)}
                    className="h-7 w-7 flex items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-100 active:scale-95 transition"
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    onClick={() => setQty(item.number, qty + 10)}
                    className="h-7 px-1.5 flex items-center justify-center rounded-full border border-gray-200 text-[11px] font-semibold text-gray-500 hover:bg-gray-100 active:scale-95 transition"
                  >
                    +10
                  </button>
                  <button
                    onClick={() => setQty(item.number, qty + 50)}
                    className="h-7 px-1.5 flex items-center justify-center rounded-full border border-gray-200 text-[11px] font-semibold text-gray-500 hover:bg-gray-100 active:scale-95 transition"
                  >
                    +50
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Bund ── */}
        <div className="border-t border-gray-100 px-4 py-3 shrink-0 flex items-center gap-3">
          <span className="flex-1 text-xs text-gray-400">
            {results.length > 0
              ? itemsWithQty > 0
                ? `${itemsWithQty} vare${itemsWithQty !== 1 ? 'r' : ''} klar til indsæt`
                : `${results.length} varer — sæt antal`
              : ''}
          </span>
          {itemsWithQty > 0 ? (
            <button
              onClick={handleAdd}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 active:scale-95 transition"
            >
              Indsæt {itemsWithQty} {itemsWithQty === 1 ? 'vare' : 'varer'}
            </button>
          ) : (
            <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">
              Luk
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
