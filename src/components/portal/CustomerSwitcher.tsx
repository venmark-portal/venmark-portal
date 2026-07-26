'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

interface Store {
  customerNo:   string
  customerName: string
}

/**
 * Kunde-vælger til "bestil på vegne af / flere butikker".
 * Henter login-kundens tilladte butikker fra BC (via /api/portal/order-access).
 * Er der ingen butikker → komponenten viser intet (kunden bestiller kun til sig selv).
 * Ved skift: opdaterer JWT-sessionen (valideres server-side) og genindlæser siden,
 * så alle priser/kalender/historik følger den valgte butik.
 */
export default function CustomerSwitcher() {
  const { data: session, update } = useSession()
  const router = useRouter()

  const [self, setSelf]     = useState<Store | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [busy, setBusy]     = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/portal/order-access')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return
        setSelf(d.self ?? null)
        setStores(Array.isArray(d.stores) ? d.stores : [])
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  // Ingen linkede butikker → ingen vælger
  if (!loaded || stores.length === 0 || !self) return null

  const own    = (session?.user as any)?.parentCustomerNumber as string ?? self.customerNo
  const active = (session?.user as any)?.activeCustomerNumber as string ?? own
  const onBehalf = active !== own

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const target = e.target.value
    if (target === active || busy) return
    setBusy(true)
    try {
      await update({ activeCustomerNumber: target })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={
        'w-full border-b px-4 py-2 md:px-6 ' +
        (onBehalf
          ? 'border-amber-300 bg-amber-50'
          : 'border-blue-100 bg-blue-50/60')
      }
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-gray-700">
          {onBehalf ? '⚠️ Bestiller for:' : 'Bestiller for:'}
        </span>
        <select
          value={active}
          onChange={handleChange}
          disabled={busy}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
        >
          <option value={self.customerNo}>
            {self.customerName} (mig selv)
          </option>
          {stores.map(s => (
            <option key={s.customerNo} value={s.customerNo}>
              {s.customerName} — {s.customerNo}
            </option>
          ))}
        </select>
        {busy && <span className="text-xs text-gray-500">Skifter…</span>}
        {onBehalf && !busy && (
          <span className="text-xs text-amber-700">
            Priser, levering og historik vises for den valgte butik.
          </span>
        )}
      </div>
    </div>
  )
}
