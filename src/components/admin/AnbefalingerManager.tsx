'use client'

import { useState, useTransition, useEffect } from 'react'
import { addPromotion, removePromotion, getPromotionsForDate } from '@/app/admin/anbefalinger/actions'
import { Search, X, Plus, Trash2, Loader2, Star } from 'lucide-react'
import type { BCItem } from '@/lib/businesscentral'

type Promo = {
  id:           string
  bcItemNumber: string
  itemName:     string
  date:         Date
  priority:     number
  note:         string | null
}

export default function AnbefalingerManager({
  initialPromotions,
  defaultDate,
}: {
  initialPromotions: Promo[]
  defaultDate:       string
}) {
  const [selectedDate, setSelectedDate] = useState(defaultDate)
  const [promos,       setPromos]       = useState<Promo[]>(initialPromotions)
  const [search,       setSearch]       = useState('')
  const [results,      setResults]      = useState<BCItem[]>([])
  const [searching,    setSearching]    = useState(false)
  const [isPending,    startTransition] = useTransition()

  // Filtrer promotions for valgt dato
  const dayPromos = promos.filter((p) => {
    const d = new Date(p.date)
    return d.toISOString().split('T')[0] === selectedDate
  })

  // BC-søgning
  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`/api/products?search=${encodeURIComponent(search)}&top=15`)
        const data = await res.json()
        setResults(data.value ?? [])
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  function handleAdd(item: BCItem) {
    startTransition(async () => {
      await addPromotion({ bcItemNumber: item.number, itemName: item.displayName, date: selectedDate })
      // Genindlæs for valgt dato
      const updated = await getPromotionsForDate(selectedDate)
      setPromos((prev) => {
        const other = prev.filter((p) => new Date(p.date).toISOString().split('T')[0] !== selectedDate)
        return [...other, ...updated]
      })
      setSearch('')
      setResults([])
    })
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      await removePromotion(id)
      setPromos((prev) => prev.filter((p) => p.id !== id))
    })
  }

  async function handleDateChange(date: string) {
    setSelectedDate(date)
    const updated = await getPromotionsForDate(date)
    setPromos((prev) => {
      const other = prev.filter((p) => new Date(p.date).toISOString().split('T')[0] !== date)
      return [...other, ...updated]
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ── Venstre: dato + nuværende anbefalinger ── */}
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Leveringsdato</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => handleDateChange(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Anbefalinger for{' '}
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('da-DK', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </h2>
          </div>

          {dayPromos.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-400">
              Ingen anbefalinger for denne dag
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {dayPromos.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <Star size={14} className="shrink-0 text-amber-400" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">{p.itemName}</div>
                    <div className="font-mono text-xs text-gray-400">{p.bcItemNumber}</div>
                  </div>
                  <button
                    onClick={() => handleRemove(p.id)}
                    disabled={isPending}
                    className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Højre: søg og tilføj ── */}
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Tilføj anbefaling</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søg på varenummer eller navn…"
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-4 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            {search && (
              <button onClick={() => { setSearch(''); setResults([]) }} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X size={14} className="text-gray-400" />
              </button>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
          {searching && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
              <Loader2 size={16} className="animate-spin" /> Søger…
            </div>
          )}
          {!searching && search.length >= 2 && results.length === 0 && (
            <div className="py-8 text-center text-sm text-gray-400">Ingen varer fundet</div>
          )}
          {!searching && search.length < 2 && (
            <div className="py-8 text-center text-sm text-gray-400">Skriv mindst 2 tegn for at søge</div>
          )}
          {results.map((item) => {
            const alreadyAdded = dayPromos.some((p) => p.bcItemNumber === item.number)
            return (
              <div key={item.id} className="flex items-center gap-3 border-b border-gray-50 px-4 py-3 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium text-gray-900">{item.displayName}</div>
                  <div className="font-mono text-xs text-gray-400">{item.number}</div>
                </div>
                <button
                  onClick={() => handleAdd(item)}
                  disabled={alreadyAdded || isPending}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    alreadyAdded
                      ? 'bg-green-50 text-green-600 cursor-default'
                      : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60'
                  }`}
                >
                  {alreadyAdded ? '✓ Tilføjet' : <><Plus size={12} /> Tilføj</>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
