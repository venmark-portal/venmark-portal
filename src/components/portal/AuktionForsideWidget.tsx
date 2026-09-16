'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Gavel } from 'lucide-react'

interface A {
  id: string; title: string; currentPrice: number; minNext: number
  priceMode: 'TOTAL' | 'PER_KG'; bidCount: number; endsAt: string; youLead: boolean
}

export default function AuktionForsideWidget() {
  const [auctions, setAuctions] = useState<A[] | null>(null)

  useEffect(() => {
    let cancel = false
    fetch('/api/portal/auktioner', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!cancel) setAuctions(Array.isArray(d.auctions) ? d.auctions : []) })
      .catch(() => { if (!cancel) setAuctions([]) })
    return () => { cancel = true }
  }, [])

  if (auctions === null) return null // undgå at blinke mens der hentes

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-900"><Gavel size={18} /> Auktioner</h2>
        <Link href="/portal/auktioner" className="text-sm font-medium text-blue-600">Se alle →</Link>
      </div>
      {auctions.length === 0 ? (
        <div className="py-2 text-sm text-gray-400">Ingen auktion lige nu.</div>
      ) : (
        <div className="space-y-1.5">
          {auctions.slice(0, 3).map((x) => (
            <Link key={x.id} href={`/portal/auktioner/${x.id}`}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition hover:bg-gray-50">
              <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{x.title}</span>
              <span className="ml-2 whitespace-nowrap text-gray-600">
                {x.currentPrice > 0 ? `${x.currentPrice} kr` : `fra ${x.minNext} kr`}{x.priceMode === 'PER_KG' ? '/kg' : ''}
                <span className="text-gray-400"> · {x.bidCount} bud</span>
                {x.youLead && <span className="ml-1 rounded bg-green-100 px-1 text-xs font-semibold text-green-700">fører</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
