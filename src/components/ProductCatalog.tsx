'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, PackageSearch } from 'lucide-react'
import SearchBar from './SearchBar'
import CategoryFilter from './CategoryFilter'
import ProductCard from './ProductCard'
import type { BCItem, BCItemCategory } from '@/lib/businesscentral'

const PAGE_SIZE = 24

export default function ProductCatalog() {
  const [items,      setItems]      = useState<BCItem[]>([])
  const [categories, setCategories] = useState<BCItemCategory[]>([])
  const [search,     setSearch]     = useState('')
  const [category,   setCategory]   = useState('')
  const [skip,       setSkip]       = useState(0)
  const [hasMore,    setHasMore]    = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  // Hent kategorier ved første render
  useEffect(() => {
    fetch('/api/categories')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCategories(data)
      })
      .catch(() => {/* ignorer — filter vises blot ikke */})
  }, [])

  const fetchItems = useCallback(
    async (opts: { replace: boolean; search: string; category: string; skip: number }) => {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams({ top: String(PAGE_SIZE), skip: String(opts.skip) })
      if (opts.search)   params.set('search',   opts.search)
      if (opts.category) params.set('category', opts.category)

      try {
        const res  = await fetch(`/api/products?${params}`)
        const data = await res.json()

        if (!res.ok) throw new Error(data.error ?? 'Fejl ved hentning af varer')

        const newItems: BCItem[] = data.value ?? []
        setItems((prev) => opts.replace ? newItems : [...prev, ...newItems])
        setHasMore(!!data['@odata.nextLink'])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ukendt fejl')
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // Hent ved mount og ved ændring af søg/filter
  useEffect(() => {
    setSkip(0)
    fetchItems({ replace: true, search, category, skip: 0 })
  }, [search, category, fetchItems])

  function loadMore() {
    const newSkip = skip + PAGE_SIZE
    setSkip(newSkip)
    fetchItems({ replace: false, search, category, skip: newSkip })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Søg + filter toolbar */}
      <div className="flex flex-col gap-4 rounded-xl border border-steel-200 bg-white p-4 shadow-sm">
        <SearchBar value={search} onChange={(v) => { setSearch(v) }} />
        <CategoryFilter
          categories={categories}
          selected={category}
          onChange={(c) => { setCategory(c) }}
        />
      </div>

      {/* Fejlbesked */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={18} className="shrink-0" />
          <span>
            <strong>Kunne ikke hente varer:</strong> {error}
          </span>
        </div>
      )}

      {/* Indlæser skeleton ved første load */}
      {loading && items.length === 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-72 animate-pulse rounded-xl border border-steel-200 bg-steel-100"
            />
          ))}
        </div>
      )}

      {/* Ingen resultater */}
      {!loading && !error && items.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-steel-400">
          <PackageSearch size={48} />
          <p className="text-sm">Ingen varer fundet.</p>
        </div>
      )}

      {/* Varekort */}
      {items.length > 0 && (
        <>
          <p className="text-sm text-steel-500">
            Viser <strong>{items.length}</strong> vare{items.length !== 1 && 'r'}
            {(search || category) && ' (filtreret)'}
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <ProductCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}

      {/* Hent flere knap */}
      {hasMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={loadMore}
            disabled={loading}
            className="
              flex items-center gap-2 rounded-lg border border-brand-500
              bg-white px-6 py-2.5 text-sm font-medium text-brand-600
              shadow-sm transition hover:bg-brand-50 disabled:opacity-60
            "
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            Vis flere varer
          </button>
        </div>
      )}

      {/* Indlæser indikator (load-more) */}
      {loading && items.length > 0 && (
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin text-brand-500" size={24} />
        </div>
      )}
    </div>
  )
}
