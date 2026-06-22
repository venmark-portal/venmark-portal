'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, X, ShoppingCart, Tag, Filter, Heart, Minus, Plus, ChevronLeft, ChevronRight, Check, Clock } from 'lucide-react'
import type { BCItem, BCItemCategory, BCItemAvailability } from '@/lib/businesscentral'

type EnrichedItem = BCItem & { unitPrice: number }

// ── Hjælper: parser BC OData Time "PT10H30M00S" eller "10:30:00" ────────────
function parseAabnTil(s: string): { hh: number; mm: number } | null {
  const iso = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?/)
  if (iso) {
    const hh = parseInt(iso[1] ?? '0'), mm = parseInt(iso[2] ?? '0')
    return (hh === 0 && mm === 0) ? null : { hh, mm }
  }
  const parts = s.split(':').map(Number)
  const hh = parts[0] ?? 0, mm = parts[1] ?? 0
  return (hh === 0 && mm === 0) ? null : { hh, mm }
}

const DA_WEEKDAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']
function formatDate(dateStr: string): string {
  const t = new Date(dateStr + 'T00:00:00')
  const diff = Math.round((new Date(t.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000)
  if (diff <= 6) return `${DA_WEEKDAYS[t.getDay()]}`
  return `${String(t.getDate()).padStart(2,'0')}/${String(t.getMonth()+1).padStart(2,'0')}`
}

interface RowStatus {
  blocked: boolean
  blockLabel: string
  disponibeltLabel: string | null
  disponibeltColor: 'red' | 'orange' | null
  aabnTilLabel: string | null
}

function computeStatus(
  avail: BCItemAvailability | undefined,
  deliveryDate: Date | undefined,
): RowStatus {
  const none: RowStatus = { blocked: false, blockLabel: '', disponibeltLabel: null, disponibeltColor: null, aabnTilLabel: null }
  if (!avail || !deliveryDate) return none

  const now = new Date()
  const deliveryStr = deliveryDate.toISOString().split('T')[0]
  const todayStr    = now.toISOString().split('T')[0]
  const isToday     = deliveryStr === todayStr

  let aabnTilLabel: string | null = null
  if (avail.aabnTil) {
    const p = parseAabnTil(avail.aabnTil)
    if (p) aabnTilLabel = `Afg.frist: kl. ${String(p.hh).padStart(2,'0')}:${String(p.mm).padStart(2,'0')}`
  }

  if (avail.tilgaengeligFra && deliveryStr < avail.tilgaengeligFra)
    return { blocked: true, blockLabel: `Tilgængelig ${formatDate(avail.tilgaengeligFra)}`, disponibeltLabel: null, disponibeltColor: null, aabnTilLabel: null }

  if (avail.strengtLager) {
    const disp = avail.disponibelt
    if (disp <= 0) {
      const label = avail.naesteLevering ? `Tilgængelig til afgang ${formatDate(avail.naesteLevering)}` : 'Ingen lager – kontakt os'
      return { blocked: true, blockLabel: label, disponibeltLabel: 'Ingen', disponibeltColor: 'red', aabnTilLabel: null }
    }
    if (disp < 50) return { blocked: false, blockLabel: '', disponibeltLabel: `${Math.round(disp*10)/10}`, disponibeltColor: 'orange', aabnTilLabel }
    return { blocked: false, blockLabel: '', disponibeltLabel: '>50', disponibeltColor: null, aabnTilLabel }
  }

  if (isToday) {
    if (avail.lukAfgang) return { blocked: true, blockLabel: 'Ikke mere i dag', disponibeltLabel: null, disponibeltColor: null, aabnTilLabel: null }
    if (avail.aabnTil) {
      const p = parseAabnTil(avail.aabnTil)
      if (p) {
        const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
        if (nowSec > p.hh * 3600 + p.mm * 60)
          return { blocked: true, blockLabel: `Frist kl. ${String(p.hh).padStart(2,'0')}:${String(p.mm).padStart(2,'0')} overskredet`, disponibeltLabel: null, disponibeltColor: null, aabnTilLabel: null }
      }
    }
    const disp = avail.disponibelt
    if (disp <= 0) return { blocked: true, blockLabel: 'Ingen disponibel i dag', disponibeltLabel: 'Ingen', disponibeltColor: 'red', aabnTilLabel }
    if (disp < 50) return { blocked: false, blockLabel: '', disponibeltLabel: `${Math.round(disp*10)/10}`, disponibeltColor: 'orange', aabnTilLabel }
    return { ...none, aabnTilLabel }
  }

  return { ...none, aabnTilLabel }
}

const PAGE_SIZE = 100

interface Props {
  /** Multi-item mode med antal — bruges i bestillingslisten */
  onAddItems?:     (items: { item: EnrichedItem; quantity: number }[]) => void
  /** Enkelt-valg mode — klik på vare → vælges straks */
  onSelect?:       (item: EnrichedItem) => void
  /** Favorit-vælger mode — checkboxes + paginering, tilføj mange på én gang */
  onAddFavorites?: (items: EnrichedItem[]) => void
  onClose:         () => void
  favNos?:         Set<string>
  onToggleFav?:    (item: EnrichedItem) => void
  /** Allerede valgte varenumre (vises som allerede markeret i favPicker) */
  existingNos?:    Set<string>
  itemAvailabilities?: Record<string, BCItemAvailability>
  deliveryDate?:   Date
}

export default function ItemSearchModal({
  onAddItems, onSelect, onAddFavorites, onClose,
  favNos, onToggleFav, existingNos = new Set(),
  itemAvailabilities, deliveryDate,
}: Props) {
  const singleMode  = !!onSelect
  const favMode     = !!onAddFavorites

  const [query,      setQuery]      = useState('')
  const [results,    setResults]    = useState<EnrichedItem[]>([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [categories, setCategories] = useState<BCItemCategory[]>([])
  const [selCat,     setSelCat]     = useState<string | null>(null)
  const [showCats,   setShowCats]   = useState(false)
  const [quantities, setQuantities] = useState<Map<string, number>>(new Map())
  const [selected,   setSelected]   = useState<Set<string>>(new Set())
  const [page,       setPage]       = useState(0)
  const [hasMore,    setHasMore]    = useState(false)
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

  // ── Hent-logik ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const hasQuery = query.trim().length >= 2
    const hasCat   = !!selCat

    // favMode: vis altid (ingen søgning = vis alle); andre modes: kræv query/cat
    if (!favMode && !hasQuery && !hasCat) {
      setResults([])
      setError('')
      return
    }

    const delay = hasQuery ? 350 : 0
    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const top = favMode ? PAGE_SIZE : 30
        const params = new URLSearchParams({ top: String(top) })
        if (favMode) params.set('skip', String(page * PAGE_SIZE))
        if (hasQuery) params.set('search', query.trim())
        if (selCat)   params.set('category', selCat)
        const res  = await fetch(`/api/products?${params}`)
        const data = await res.json()
        if (!res.ok || data.error) {
          setError(data.error ?? `Fejl fra server (${res.status})`)
          setResults([])
          setHasMore(false)
        } else {
          const items = data.value ?? []
          setResults(items)
          setHasMore(favMode && items.length === PAGE_SIZE)
        }
      } catch {
        setError('Kunne ikke nå serveren — prøv igen')
        setResults([])
        setHasMore(false)
      } finally {
        setLoading(false)
      }
    }, delay)

    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selCat, page, favMode])

  // Nulstil side ved filter-ændring
  useEffect(() => { setPage(0) }, [query, selCat])

  // ── Hjælpefunktioner ──────────────────────────────────────────────────────────
  function setQty(itemNo: string, qty: number) {
    setQuantities(prev => {
      const next = new Map(prev)
      if (qty <= 0) next.delete(itemNo)
      else next.set(itemNo, qty)
      return next
    })
  }

  function toggleSelect(itemNo: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(itemNo)) next.delete(itemNo)
      else next.add(itemNo)
      return next
    })
  }

  function handleAdd() {
    if (!onAddItems) return
    const toAdd = results
      .filter(r => (quantities.get(r.number) ?? 0) > 0)
      .map(r => ({ item: r, quantity: quantities.get(r.number)! }))
    if (toAdd.length === 0) return
    onAddItems(toAdd)
    onClose()
  }

  function handleAddFavorites() {
    if (!onAddFavorites) return
    const toAdd = results.filter(r => selected.has(r.number))
    if (toAdd.length === 0) return
    onAddFavorites(toAdd)
    onClose()
  }

  const fmt = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })
  const selectedCatLabel = selCat ? (categories.find(c => c.code === selCat)?.displayName ?? selCat) : null
  const itemsWithQty = results.filter(r => (quantities.get(r.number) ?? 0) > 0).length

  // ── Render ────────────────────────────────────────────────────────────────────
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
            placeholder={favMode ? 'Filtrer på navn eller varenummer…' : 'Søg på varenummer eller navn…'}
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
                onClick={() => { setSelCat(null); setShowCats(false) }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  !selCat ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Alle
              </button>
              {categories.map(cat => (
                <button
                  key={cat.code}
                  onClick={() => { setSelCat(c => c === cat.code ? null : cat.code); setShowCats(false) }}
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

        {/* Paginering øverst (kun favMode) */}
        {favMode && !loading && results.length > 0 && (
          <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-100 bg-gray-50/60 shrink-0">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30"
            >
              <ChevronLeft size={13} /> Forrige
            </button>
            <span className="text-xs text-gray-400">
              Side {page + 1}{hasMore ? '+' : ''} · {results.length} varer
              {selected.size > 0 && <span className="ml-2 font-semibold text-blue-600">{selected.size} valgt</span>}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!hasMore}
              className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30"
            >
              Næste <ChevronRight size={13} />
            </button>
          </div>
        )}

        {/* ── Resultater ── */}
        <div className="overflow-y-auto flex-1">
          {loading && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">Henter…</div>
          )}
          {!loading && error && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-red-600 font-medium">Fejl</p>
              <p className="text-xs text-gray-400 mt-1">{error}</p>
            </div>
          )}
          {!loading && !error && !favMode && !selCat && query.trim().length < 2 && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              Skriv mindst 2 tegn, eller vælg en kategori via <Filter size={13} className="inline" />
            </div>
          )}
          {!loading && !error && results.length === 0 && (favMode || query.trim().length >= 2 || selCat) && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              Ingen varer fundet
              {query.trim().length >= 2 && <> for &ldquo;{query}&rdquo;</>}
              {selCat && <> i {selectedCatLabel}</>}
            </div>
          )}

          {results.map((item) => {
            const picUrl  = item.picture?.id
              ? `/api/portal/item-image/${item.id}?pictureId=${item.picture.id}`
              : null
            const qty      = quantities.get(item.number) ?? 0
            const isFav    = favNos?.has(item.number) ?? false
            const isExist  = existingNos.has(item.number)
            const isSel    = selected.has(item.number)
            const status   = (!favMode && !singleMode)
              ? computeStatus(itemAvailabilities?.[item.number], deliveryDate)
              : { blocked: false, blockLabel: '', disponibeltLabel: null, disponibeltColor: null as null, aabnTilLabel: null }

            return (
              <div
                key={item.id}
                className={`px-3 py-2 border-b border-gray-50 last:border-0 transition-colors ${
                  status.blocked ? 'opacity-70' : ''
                } ${
                  favMode
                    ? (isExist ? 'opacity-40' : isSel ? 'bg-blue-50' : 'cursor-pointer hover:bg-gray-50/60')
                    : singleMode
                    ? 'cursor-pointer hover:bg-blue-50/60 active:bg-blue-100'
                    : qty > 0 ? 'bg-blue-50/50' : ''
                }`}
                onClick={
                  favMode && !isExist ? () => toggleSelect(item.number)
                  : singleMode ? () => onSelect!(item as EnrichedItem)
                  : undefined
                }
              >
                {/* Status-badges */}
                {status.blockLabel && (
                  <div className="mb-1 flex items-center gap-1 text-[10px] text-red-600 bg-red-50 rounded px-1.5 py-0.5 w-fit font-semibold">
                    <X size={9} />
                    {status.blockLabel}
                  </div>
                )}
                {!status.blockLabel && status.aabnTilLabel && (
                  <div className="mb-1 flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 w-fit">
                    <Clock size={9} />
                    {status.aabnTilLabel}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {/* Checkbox i favMode */}
                  {favMode && (
                    <div className={`shrink-0 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                      isExist
                        ? 'border-gray-200 bg-gray-100'
                        : isSel
                        ? 'border-blue-600 bg-blue-600'
                        : 'border-gray-300'
                    }`}>
                      {(isSel || isExist) && <Check size={12} className="text-white" strokeWidth={3} />}
                    </div>
                  )}

                  {/* Billede */}
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
                    <div className="flex items-center gap-1.5 text-xs text-gray-400 flex-wrap">
                      <span className="font-mono">{item.number}</span>
                      {item.unitPrice > 0 && (
                        <><span>·</span>
                        <span className="font-semibold text-gray-600">{fmt.format(item.unitPrice)}/{item.baseUnitOfMeasureCode}</span></>
                      )}
                      {status.disponibeltLabel && (
                        <span className={`rounded px-1 py-0 leading-tight text-[10px] font-semibold ${
                          status.disponibeltColor === 'red'
                            ? 'bg-red-100 text-red-600'
                            : status.disponibeltColor === 'orange'
                              ? 'bg-orange-100 text-orange-600'
                              : 'bg-gray-100 text-gray-500'
                        }`}>
                          {status.disponibeltLabel} {item.baseUnitOfMeasureCode}
                        </span>
                      )}
                      {isExist && <span className="text-gray-400 italic">allerede favorit</span>}
                    </div>
                  </div>

                  {/* Hjerte — kun i multi-mode */}
                  {!singleMode && !favMode && onToggleFav && (
                    <button
                      onClick={e => { e.stopPropagation(); onToggleFav(item as EnrichedItem) }}
                      className={`shrink-0 p-1 rounded-full transition-colors ${
                        isFav ? 'text-red-400 hover:text-red-300' : 'text-gray-200 hover:text-red-300'
                      }`}
                      title={isFav ? 'Fjern favorit' : 'Tilføj favorit'}
                    >
                      <Heart size={15} fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                  )}

                  {/* Plus-indikator i singleMode */}
                  {singleMode && <Plus size={16} className="shrink-0 text-blue-400" />}
                </div>

                {/* Antal-knapper — kun i multi-mode (order list) */}
                {!singleMode && !favMode && (
                  <div className="flex items-center gap-1 justify-end mt-1.5">
                    <button
                      onClick={() => setQty(item.number, Math.max(0, qty - 1))}
                      disabled={qty === 0 || status.blocked}
                      tabIndex={-1}
                      className="h-7 w-7 flex items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-25 active:scale-95 transition"
                    >
                      <Minus size={12} />
                    </button>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={qty || ''}
                      placeholder="0"
                      disabled={status.blocked}
                      data-modal-qty-input="true"
                      onChange={(e) => setQty(item.number, Math.max(0, parseFloat(e.target.value) || 0))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-modal-qty-input]'))
                          const idx = inputs.indexOf(e.currentTarget)
                          if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus()
                        }
                      }}
                      className="w-10 rounded border border-gray-200 py-1 text-center text-sm font-semibold focus:border-blue-400 focus:outline-none disabled:opacity-40"
                    />
                    <button
                      onClick={() => setQty(item.number, qty + 1)}
                      disabled={status.blocked}
                      tabIndex={-1}
                      className="h-7 w-7 flex items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-25 active:scale-95 transition"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Bund ── */}
        <div className="border-t border-gray-100 px-4 py-3 shrink-0 flex items-center gap-3">
          {favMode ? (
            <>
              <span className="flex-1 text-xs text-gray-400">
                {selected.size > 0
                  ? `${selected.size} vare${selected.size !== 1 ? 'r' : ''} valgt`
                  : 'Klik på varer for at markere dem'}
              </span>
              {selected.size > 0 ? (
                <button
                  onClick={handleAddFavorites}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 active:scale-95 transition"
                >
                  Tilføj {selected.size} favorit{selected.size !== 1 ? 'ter' : ''}
                </button>
              ) : (
                <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">
                  Luk
                </button>
              )}
            </>
          ) : singleMode ? (
            <>
              <span className="flex-1 text-xs text-gray-400">
                {results.length > 0 ? `${results.length} varer — klik for at vælge` : ''}
              </span>
              <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">
                Luk
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
