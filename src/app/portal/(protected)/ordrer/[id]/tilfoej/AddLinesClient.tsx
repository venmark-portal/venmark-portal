'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Trash2, ArrowLeft, CheckCircle2, Heart } from 'lucide-react'
import { OrderRow } from '@/components/portal/OrderList'
import type { EnrichedItem, PriceTier } from '@/components/portal/OrderList'
import ItemSearchModal from '@/components/portal/ItemSearchModal'

interface BasketLine {
  bcItemNumber: string
  itemName:     string
  quantity:     number
  uom:          string
  unitPrice:    number
}

interface Props {
  orderId:             string
  bcOrderNumber?:      string
  deliveryLabel:       string
  deadline:            string
  stdFavorites?:       EnrichedItem[]
  favorites?:          EnrichedItem[]
  venmarkItems?:       { item: EnrichedItem; note: string }[]
  priceTiers?:         PriceTier[]
  initialFavNos?:      string[]
  itemAvailabilities?: Record<string, any>
}

export default function AddLinesClient({
  orderId, bcOrderNumber, deliveryLabel,
  stdFavorites = [], favorites = [], venmarkItems = [],
  priceTiers = [], initialFavNos = [],
  itemAvailabilities = {},
}: Props) {
  const router = useRouter()

  // Lokal kurv per varenr
  const [qtyMap,    setQtyMap]    = useState<Map<string, number>>(new Map())
  const [uomMap,    setUomMap]    = useState<Map<string, string>>(new Map())
  // Items tilføjet via søgning (ikke i de tre faste sektioner) — gemmes for at kunne bygge kurv
  const [searchedItems, setSearchedItems] = useState<Map<string, EnrichedItem>>(new Map())
  const [showSearch, setShowSearch] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState('')

  const favSet = new Set(initialFavNos)

  function getQty(itemNo: string) { return qtyMap.get(itemNo) ?? 0 }
  function setQty(item: EnrichedItem, qty: number) {
    setQtyMap(prev => {
      const next = new Map(prev)
      if (qty <= 0) next.delete(item.number)
      else          next.set(item.number, qty)
      return next
    })
    if (!uomMap.has(item.number)) {
      setUomMap(prev => {
        const next = new Map(prev)
        next.set(item.number, item.baseUnitOfMeasureCode)
        return next
      })
    }
  }
  function setLineUom(item: EnrichedItem, code: string) {
    setUomMap(prev => {
      const next = new Map(prev)
      next.set(item.number, code)
      return next
    })
  }

  function addSearchedItems(items: { item: EnrichedItem; quantity: number }[]) {
    setSearchedItems(prev => {
      const next = new Map(prev)
      for (const { item } of items) next.set(item.number, item)
      return next
    })
    setQtyMap(prev => {
      const next = new Map(prev)
      for (const { item, quantity } of items) {
        next.set(item.number, (next.get(item.number) ?? 0) + quantity)
      }
      return next
    })
    setUomMap(prev => {
      const next = new Map(prev)
      for (const { item } of items) {
        if (!next.has(item.number)) next.set(item.number, item.baseUnitOfMeasureCode)
      }
      return next
    })
    setShowSearch(false)
  }

  // Saml kurven til submit
  function buildBasket(): BasketLine[] {
    const itemIndex = new Map<string, EnrichedItem>()
    for (const i of stdFavorites)   itemIndex.set(i.number, i)
    for (const i of favorites)      itemIndex.set(i.number, i)
    for (const v of venmarkItems)   itemIndex.set(v.item.number, v.item)
    for (const [n, i] of searchedItems) itemIndex.set(n, i)

    const lines: BasketLine[] = []
    for (const [itemNo, qty] of qtyMap) {
      if (qty <= 0) continue
      const item = itemIndex.get(itemNo)
      const uom  = uomMap.get(itemNo) ?? item?.baseUnitOfMeasureCode ?? 'KG'
      lines.push({
        bcItemNumber: itemNo,
        itemName:     item?.displayName ?? itemNo,
        quantity:     qty,
        uom,
        unitPrice:    item?.unitPrice ?? 0,
      })
    }
    return lines
  }

  async function submit() {
    const basket = buildBasket()
    if (!basket.length) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/portal/order/${orderId}/lines`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ lines: basket }),
      })
      if (res.ok) {
        setDone(true)
        setTimeout(() => router.push('/portal/ordrer'), 1500)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Fejl fra server (${res.status})`)
      }
    } catch {
      setError('Serverfejl — prøv igen')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-green-600">
        <CheckCircle2 size={48} />
        <p className="font-semibold text-lg">Tilføjet!</p>
      </div>
    )
  }

  const basketLines = buildBasket()
  // Søgte items vist som en ekstra sektion så brugeren kan justere antal/enhed
  const searchedOnly = Array.from(searchedItems.values())
    .filter(i => !stdFavorites.some(s => s.number === i.number)
              && !favorites.some(f => f.number === i.number)
              && !venmarkItems.some(v => v.item.number === i.number))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Tilføj vare</h1>
          <p className="text-xs text-gray-500">
            Levering {deliveryLabel}
            {bcOrderNumber && <span className="ml-1 font-mono">#{bcOrderNumber}</span>}
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
        {/* Søg og tilføj vare */}
        <div className="border-b border-dashed border-gray-200">
          <button
            onClick={() => setShowSearch(true)}
            className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-blue-600 hover:bg-blue-50 transition"
          >
            <Search size={15} />
            Søg og tilføj vare
          </button>
        </div>

        {/* Tilføjet via søgning */}
        {searchedOnly.length > 0 && (
          <>
            <div className="px-3 py-1.5 bg-gray-100 border-y border-gray-200 text-xs font-bold uppercase tracking-wide text-gray-700 flex items-center gap-1.5">
              <Search size={12} /> Tilføjet via søgning
            </div>
            <div className="divide-y divide-blue-200">
              {searchedOnly.map((item) => (
                <OrderRow
                  key={`s-${item.number}`}
                  item={item} quantity={getQty(item.number)}
                  onQty={qty => setQty(item, qty)} priceTiers={priceTiers}
                  isFavorite={favSet.has(item.number)}
                  selectedUom={uomMap.get(item.number)}
                  onUomChange={code => setLineUom(item, code)}
                />
              ))}
            </div>
          </>
        )}

        {/* STD-favoritter */}
        {stdFavorites.length > 0 && (
          <>
            <div className="px-3 py-1.5 bg-amber-100 border-y-2 border-amber-300 text-xs font-bold uppercase tracking-wide text-amber-900 flex items-center gap-1.5">
              <span className="text-base leading-none">✪</span> STD — varer du altid skal have
            </div>
            <div className="divide-y divide-amber-100 bg-amber-50/40">
              {stdFavorites.map((item) => (
                <OrderRow
                  key={`std-${item.number}`}
                  item={item} quantity={getQty(item.number)}
                  onQty={qty => setQty(item, qty)} priceTiers={priceTiers}
                  isFavorite={favSet.has(item.number)}
                  selectedUom={uomMap.get(item.number)}
                  onUomChange={code => setLineUom(item, code)}
                />
              ))}
            </div>
          </>
        )}

        {/* Almindelige favoritter */}
        {favorites.length > 0 && (
          <>
            <div className="px-3 py-1.5 bg-rose-100 border-y-2 border-rose-300 text-xs font-bold uppercase tracking-wide text-rose-900 flex items-center gap-1.5">
              <Heart size={13} className="text-rose-600 fill-rose-600" /> Dine favoritter
            </div>
            <div className="divide-y divide-blue-200">
              {favorites.map((item) => (
                <OrderRow
                  key={`fav-${item.number}`}
                  item={item} quantity={getQty(item.number)}
                  onQty={qty => setQty(item, qty)} priceTiers={priceTiers}
                  isFavorite={favSet.has(item.number)}
                  selectedUom={uomMap.get(item.number)}
                  onUomChange={code => setLineUom(item, code)}
                />
              ))}
            </div>
          </>
        )}

        {/* Venmark anbefaler */}
        {venmarkItems.length > 0 && (
          <>
            <div className="px-3 py-1 bg-blue-50 border-y border-blue-100 text-[10px] font-semibold uppercase tracking-wide text-blue-700 flex items-center gap-1">
              <span className="text-[11px]">⭐</span> Venmark anbefaler
            </div>
            <div className="divide-y divide-blue-200">
              {venmarkItems.map(({ item, note }) => (
                <OrderRow
                  key={`ven-${item.number}`}
                  item={item} quantity={getQty(item.number)}
                  onQty={qty => setQty(item, qty)} priceTiers={priceTiers}
                  isVenmark={true} venmarkNote={note}
                  isFavorite={favSet.has(item.number)}
                  selectedUom={uomMap.get(item.number)}
                  onUomChange={code => setLineUom(item, code)}
                />
              ))}
            </div>
          </>
        )}

        {stdFavorites.length === 0 && favorites.length === 0 && venmarkItems.length === 0 && searchedOnly.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">Søg ovenfor for at tilføje varer til ordren.</p>
        )}
      </div>

      {/* Kurv-oversigt + submit */}
      {basketLines.length > 0 && (
        <div className="space-y-2 sticky bottom-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Tilføjes</p>
          <div className="rounded-xl bg-white ring-1 ring-gray-200 divide-y divide-gray-50">
            {basketLines.map((line) => (
              <div key={line.bcItemNumber} className="flex items-center justify-between px-4 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="mr-2 font-mono text-xs text-gray-400">{line.bcItemNumber}</span>
                  <span className="text-gray-800">{line.itemName}</span>
                </div>
                <div className="ml-3 shrink-0 flex items-center gap-1">
                  <span className="text-xs text-gray-700 font-medium">{line.quantity}</span>
                  <span className="ml-1 text-xs text-gray-400 w-8">{line.uom}</span>
                  <button
                    onClick={() => setQtyMap(prev => { const n = new Map(prev); n.delete(line.bcItemNumber); return n })}
                    className="ml-1 text-gray-300 hover:text-red-400"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button
            onClick={submit}
            disabled={saving}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Tilføjer...' : `Tilføj ${basketLines.length} ${basketLines.length === 1 ? 'vare' : 'varer'} til ordren`}
          </button>
        </div>
      )}

      {/* Søgning/katalog modal — samme komponent som bestil-siden */}
      {showSearch && (
        <ItemSearchModal
          onAddItems={addSearchedItems}
          onClose={() => setShowSearch(false)}
          favNos={favSet}
          itemAvailabilities={itemAvailabilities}
        />
      )}
    </div>
  )
}
