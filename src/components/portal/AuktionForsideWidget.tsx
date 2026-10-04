'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Gavel } from 'lucide-react'

interface A {
  id: string; title: string; currentPrice: number; minNext: number
  priceMode: 'TOTAL' | 'PER_KG'; bidCount: number; endsAt: string; youLead: boolean
}

/** Tid tilbage — samme format som auktionslisten ("1t 20m" / "20:05"). */
function nedtaelling(endsAt: string, now: number): string {
  const d = new Date(endsAt).getTime() - now
  if (d <= 0) return 'Afsluttet'
  const s = Math.floor(d / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  return h > 0 ? `${h}t ${m}m` : `${m}:${String(ss).padStart(2, '0')}`
}

export default function AuktionForsideWidget() {
  const [auctions, setAuctions] = useState<A[] | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancel = false
    fetch('/api/portal/auktioner', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!cancel) setAuctions(Array.isArray(d.auctions) ? d.auctions : []) })
      .catch(() => { if (!cancel) setAuctions([]) })
    return () => { cancel = true }
  }, [])

  // Uret går kun når der ER en auktion — ellers er der ingen grund til at vække siden.
  useEffect(() => {
    if (!auctions || auctions.length === 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [auctions])

  if (auctions === null) return null       // undgå at blinke mens der hentes
  if (auctions.length === 0) return null   // ingen auktion → ingen tom boks på forsiden

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-900"><Gavel size={18} /> Auktioner</h2>
        <Link href="/portal/auktioner" className="text-sm font-medium text-blue-600">Se alle →</Link>
      </div>
      <div className="space-y-1.5">
        {/* Listen kommer sorteret på endsAt fra API'et, så index 0 er den der udløber først.
            Kun den får nedtælling — det er den eneste man skal nå. */}
        {auctions.slice(0, 3).map((x, i) => {
          const tilbage = new Date(x.endsAt).getTime() - now
          const snart   = tilbage > 0 && tilbage < 2 * 60 * 1000
          return (
            <Link key={x.id} href={`/portal/auktioner/${x.id}`}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition hover:bg-gray-50">
              <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{x.title}</span>
              <span className="ml-2 flex items-center gap-1 whitespace-nowrap text-gray-600">
                {i === 0 && (
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                    snart ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {nedtaelling(x.endsAt, now)}
                  </span>
                )}
                <span>
                  {x.currentPrice > 0 ? `${x.currentPrice} kr` : `fra ${x.minNext} kr`}{x.priceMode === 'PER_KG' ? '/kg' : ''}
                  <span className="text-gray-400"> · {x.bidCount} bud</span>
                </span>
                {x.youLead && <span className="rounded bg-green-100 px-1 text-xs font-semibold text-green-700">fører</span>}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
