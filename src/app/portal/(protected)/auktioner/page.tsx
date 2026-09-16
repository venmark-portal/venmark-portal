'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface A {
  id: string; title: string; priceMode: 'TOTAL' | 'PER_KG'
  currentPrice: number; bidCount: number; minNext: number
  endsAt: string; ended: boolean; youLead: boolean; lotText: string | null; thumbId: string | null
}

function useNow(ms = 1000) {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return n
}

export function countdown(endsAt: string, now: number): string {
  const d = new Date(endsAt).getTime() - now
  if (d <= 0) return 'Afsluttet'
  const s = Math.floor(d / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  return h > 0 ? `${h}t ${m}m` : `${m}:${String(ss).padStart(2, '0')}`
}

export default function AuktionerListePage() {
  const [auctions, setAuctions] = useState<A[]>([])
  const [loading, setLoading] = useState(true)
  const now = useNow()

  useEffect(() => {
    let cancel = false
    const load = async () => {
      try {
        const r = await fetch('/api/portal/auktioner', { cache: 'no-store' })
        const d = await r.json()
        if (!cancel) setAuctions(Array.isArray(d.auctions) ? d.auctions : [])
      } catch { /* ignore */ }
      if (!cancel) setLoading(false)
    }
    load()
    const t = setInterval(load, 5000)
    return () => { cancel = true; clearInterval(t) }
  }, [])

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-bold text-gray-900">Auktioner</h1>

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">Henter…</div>
      ) : auctions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center text-gray-500">Ingen auktion lige nu.</div>
      ) : (
        <div className="space-y-3">
          {auctions.map((a) => {
            const left = new Date(a.endsAt).getTime() - now
            const soon = left > 0 && left < 2 * 60 * 1000
            return (
              <Link key={a.id} href={`/portal/auktioner/${a.id}`}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm transition hover:border-blue-300">
                {a.thumbId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/portal/auktion-image/${a.thumbId}`} alt="" className="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-2xl">🐟</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-gray-900">{a.title}</div>
                  {a.lotText && <div className="truncate text-xs text-gray-500">{a.lotText}</div>}
                  <div className="mt-0.5 text-sm">
                    <span className="font-bold text-gray-900">{a.currentPrice > 0 ? `${a.currentPrice} kr` : `fra ${a.minNext} kr`}</span>
                    <span className="text-gray-400">{a.priceMode === 'PER_KG' ? ' /kg' : ''} · {a.bidCount} bud</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${soon ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                    {countdown(a.endsAt, now)}
                  </span>
                  {a.youLead && <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Du fører</span>}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
