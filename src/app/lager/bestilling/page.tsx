'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, ClipboardList, Plus, ShoppingCart } from 'lucide-react'

interface Bestilling {
  id: string
  no: string
  locationCode: string
  status: string
  startedAt: string
  createdByName: string
  bcOrderNos: string | null
  bcLines: number | null
  bcFailed: number | null
}

/**
 * Forsiden i bestillingsappen: fortsæt en kurv, eller start en ny.
 *
 * Alle åbne kurve vises — ikke kun ens egne. To mand i kølegangen skal kunne fylde den
 * samme kurv, og den ene skal kunne se at den anden er i gang. Ellers ender dagen med
 * to halve bestillinger til samme leverandør.
 */
export default function BestillingForside() {
  const [aabne, setAabne] = useState<Bestilling[]>([])
  const [sendte, setSendte] = useState<Bestilling[]>([])
  const [travl, setTravl] = useState(false)
  const [fejl, setFejl] = useState('')
  const [henter, setHenter] = useState(true)

  useEffect(() => {
    fetch('/api/lager/bestilling', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        setAabne(d.aabne ?? [])
        setSendte(d.sendte ?? [])
      })
      .catch(() => setFejl('Kunne ikke hente bestillingerne'))
      .finally(() => setHenter(false))
  }, [])

  async function start() {
    setTravl(true)
    setFejl('')
    try {
      const res = await fetch('/api/lager/bestilling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        setFejl('Kunne ikke starte en bestilling')
        return
      }
      const b = await res.json()
      window.location.href = `/lager/bestilling/${b.id}`
    } finally {
      setTravl(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 pb-24 pt-12">
      <header className="mb-4 flex items-center gap-3">
        <Link href="/lager" className="rounded-full bg-white p-2 ring-1 ring-gray-200" aria-label="Tilbage">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Bestilling</h1>
          <p className="text-sm text-gray-500">Scan hvad der mangler — BC laver købsordrerne</p>
        </div>
      </header>

      {fejl && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{fejl}</p>}

      <button
        onClick={start}
        disabled={travl}
        className="flex w-full items-center justify-between rounded-2xl bg-emerald-700 px-4 py-4 text-white disabled:opacity-50"
      >
        <span>
          <span className="block font-semibold">Ny bestilling</span>
          <span className="block text-sm text-emerald-100">Scan frit — der deles op pr. leverandør</span>
        </span>
        <Plus size={22} />
      </button>

      {aabne.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Åbne bestillinger
          </h2>
          <ul className="space-y-2">
            {aabne.map(b => (
              <li key={b.id}>
                <Link
                  href={`/lager/bestilling/${b.id}`}
                  className="flex items-center justify-between rounded-2xl bg-white p-4 ring-1 ring-gray-200"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-gray-900">{b.no}</span>
                    <span className="block truncate text-sm text-gray-500">
                      {b.createdByName}
                      {b.locationCode ? ` · ${b.locationCode}` : ''} ·{' '}
                      {new Date(b.startedAt).toLocaleString('da-DK', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </span>
                  <ShoppingCart size={20} className="shrink-0 text-emerald-700" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {henter && <p className="mt-6 text-center text-sm text-gray-400">Henter …</p>}

      {sendte.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Sendt til BC
          </h2>
          <ul className="space-y-2">
            {sendte.map(b => (
              <li key={b.id} className="rounded-2xl bg-white p-4 ring-1 ring-gray-200">
                <div className="flex items-start gap-3">
                  <Check size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900">{b.no}</p>
                    <p className="text-sm text-gray-600">
                      {b.bcLines ?? 0} linje{(b.bcLines ?? 0) === 1 ? '' : 'r'}
                      {b.bcOrderNos ? ` · købsordre ${b.bcOrderNos}` : ''}
                    </p>
                    {(b.bcFailed ?? 0) > 0 && (
                      <p className="text-sm font-semibold text-amber-700">
                        {b.bcFailed} linje(r) kom ikke på en ordre — se bestillingen i BC
                      </p>
                    )}
                    <p className="text-xs text-gray-400">{b.createdByName}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-8 flex items-start gap-2 rounded-2xl bg-gray-50 p-3 text-xs text-gray-500 ring-1 ring-gray-200">
        <ClipboardList size={15} className="mt-0.5 shrink-0" />
        <span>
          Appen sender <strong>ikke</strong> til leverandøren. Den laver åbne købsordrer i BC, som
          kontoret godkender og sender. En bestilling der er sendt til BC kan ikke fyldes på —
          start en ny, eller ret købsordren i BC.
        </span>
      </p>
    </div>
  )
}
