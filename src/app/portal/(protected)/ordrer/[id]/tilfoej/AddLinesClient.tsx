'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Plus, Minus, Trash2, ArrowLeft, CheckCircle2, Heart } from 'lucide-react'

interface LineItem {
  bcItemNumber: string
  itemName:     string
  quantity:     number
  uom:          string
  unitPrice:    number
}

interface FavoriteItem {
  number:                string
  displayName:           string
  baseUnitOfMeasureCode: string
  unitPrice:             number
}

interface Props {
  orderId:         string
  bcOrderNumber?:  string
  deliveryLabel:   string
  deadline:        string
  favorites?:      FavoriteItem[]
}

export default function AddLinesClient({ orderId, bcOrderNumber, deliveryLabel, deadline, favorites = [] }: Props) {
  const router = useRouter()
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState<any[]>([])
  const [loading,  setLoading]  = useState(false)
  const [basket,   setBasket]   = useState<LineItem[]>([])
  const [saving,   setSaving]   = useState(false)
  const [done,     setDone]     = useState(false)
  const [error,    setError]    = useState('')

  async function search(q: string) {
    setQuery(q)
    if (q.trim().length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res  = await fetch(`/api/products?search=${encodeURIComponent(q)}&top=20`)
      const data = await res.json()
      setResults(data.value ?? [])
    } finally {
      setLoading(false)
    }
  }

  function addToBasket(item: { number: string; displayName: string; baseUnitOfMeasureCode?: string; unitPrice?: number }) {
    setBasket((prev) => {
      const existing = prev.find((l) => l.bcItemNumber === item.number)
      if (existing) {
        return prev.map((l) => l.bcItemNumber === item.number ? { ...l, quantity: l.quantity + 1 } : l)
      }
      return [...prev, {
        bcItemNumber: item.number,
        itemName:     item.displayName,
        quantity:     1,
        uom:          item.baseUnitOfMeasureCode ?? 'KG',
        unitPrice:    item.unitPrice ?? 0,
      }]
    })
  }

  function setQty(itemNumber: string, qty: number) {
    if (qty <= 0) {
      setBasket((prev) => prev.filter((l) => l.bcItemNumber !== itemNumber))
    } else {
      setBasket((prev) => prev.map((l) => l.bcItemNumber === itemNumber ? { ...l, quantity: qty } : l))
    }
  }

  async function submit() {
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

      {/* Favoritter */}
      {favorites.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
            <Heart size={12} className="text-red-400" /> Dine favoritter
          </p>
          <div className="rounded-xl bg-white ring-1 ring-gray-200 divide-y divide-gray-50">
            {favorites.map((item) => {
              const inBasket = basket.find((l) => l.bcItemNumber === item.number)
              return (
                <div key={item.number} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="mr-2 font-mono text-xs text-gray-400">{item.number}</span>
                    <span className="text-gray-800">{item.displayName}</span>
                  </div>
                  <div className="ml-3 shrink-0 flex items-center gap-2">
                    {item.unitPrice > 0 && (
                      <span className="text-xs text-gray-400">
                        {new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK' }).format(item.unitPrice)}
                      </span>
                    )}
                    {inBasket ? (
                      <span className="text-xs text-blue-600 font-medium">+{inBasket.quantity}</span>
                    ) : null}
                    <button
                      onClick={() => addToBasket(item)}
                      className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white hover:bg-blue-700"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Søg */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Søg på varenummer eller navn..."
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Søgeresultater */}
      {results.length > 0 && (
        <div className="rounded-xl bg-white ring-1 ring-gray-200 divide-y divide-gray-50">
          {results.map((item) => {
            const inBasket = basket.find((l) => l.bcItemNumber === item.number)
            return (
              <div key={item.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="mr-2 font-mono text-xs text-gray-400">{item.number}</span>
                  <span className="text-gray-800">{item.displayName}</span>
                </div>
                <div className="ml-3 shrink-0 flex items-center gap-2">
                  {item.unitPrice > 0 && (
                    <span className="text-xs text-gray-400">
                      {new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK' }).format(item.unitPrice)}
                    </span>
                  )}
                  {inBasket ? (
                    <span className="text-xs text-blue-600 font-medium">+{inBasket.quantity}</span>
                  ) : null}
                  <button
                    onClick={() => addToBasket(item)}
                    className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {loading && <p className="text-center text-sm text-gray-400">Søger...</p>}

      {/* Kurv */}
      {basket.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Tilføjes</p>
          <div className="rounded-xl bg-white ring-1 ring-gray-200 divide-y divide-gray-50">
            {basket.map((line) => (
              <div key={line.bcItemNumber} className="flex items-center justify-between px-4 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="mr-2 font-mono text-xs text-gray-400">{line.bcItemNumber}</span>
                  <span className="text-gray-800">{line.itemName}</span>
                </div>
                <div className="ml-3 shrink-0 flex items-center gap-1">
                  <button onClick={() => setQty(line.bcItemNumber, line.quantity - 1)} className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200">
                    <Minus size={11} />
                  </button>
                  <input
                    type="number"
                    value={line.quantity}
                    min={1}
                    onChange={(e) => setQty(line.bcItemNumber, Number(e.target.value))}
                    className="w-12 text-center text-sm border border-gray-200 rounded-lg py-0.5"
                  />
                  <button onClick={() => setQty(line.bcItemNumber, line.quantity + 1)} className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200">
                    <Plus size={11} />
                  </button>
                  <span className="ml-1 text-xs text-gray-400 w-6">{line.uom}</span>
                  <button onClick={() => setQty(line.bcItemNumber, 0)} className="ml-1 text-gray-300 hover:text-red-400">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={submit}
            disabled={saving}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Tilføjer...' : `Tilføj ${basket.length} ${basket.length === 1 ? 'vare' : 'varer'} til ordren`}
          </button>
        </div>
      )}
    </div>
  )
}
