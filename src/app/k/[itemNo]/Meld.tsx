'use client'

// Knappen. Ét tryk melder hylden tom; er den meldt i forvejen, kan meldingen lukkes.
//
// Begge knapper er store og ligger langt fra hinanden: det her bruges med handsker på,
// i kølerummet, med en kasse under armen.
//
// Lukningen hører HER, selv om listen står på kontorskærmen. Skærmen kan ikke trykkes
// på, og den der lige har bestilt varen står typisk med telefonen i hånden alligevel.
// Uden en vej til at lukke stod de samme fem varer på skærmen i ugevis.

import { useState } from 'react'
import { Check, PackageX } from 'lucide-react'

export interface Meldt {
  lastAt:  string
  meldtAf: string
  antal:   number
}

export default function Meld({
  itemNo,
  alleredeMeldt,
}: {
  itemNo: string
  alleredeMeldt: Meldt | null
}) {
  const [meldt, setMeldt] = useState<Meldt | null>(alleredeMeldt)
  const [travl, setTravl] = useState(false)
  const [fejl, setFejl] = useState('')

  async function send(handling: 'meld' | 'bestilt') {
    setTravl(true)
    setFejl('')
    try {
      const res = await fetch('/api/kanban', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // no-store: et POST må aldrig besvares fra en cache.
        cache:   'no-store',
        body:    JSON.stringify({ itemNo, handling }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFejl(data.error ?? 'Kunne ikke sende. Prøv igen.')
        return
      }
      if (handling === 'meld') {
        setMeldt({ lastAt: new Date().toISOString(), meldtAf: '', antal: data.antal ?? 1 })
      } else {
        setMeldt(null)
      }
    } catch {
      setFejl('Ingen forbindelse. Prøv igen om et øjeblik.')
    } finally {
      setTravl(false)
    }
  }

  if (meldt) {
    return (
      <div className="mt-auto flex flex-col gap-4">
        <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-300">
          <p className="text-lg font-bold text-amber-900">Meldt tom</p>
          <p className="mt-1 text-sm text-amber-800">
            {tidspunkt(meldt.lastAt)}
            {meldt.meldtAf && ` · ${meldt.meldtAf}`}
            {meldt.antal > 1 && ` · meldt ${meldt.antal} gange`}
          </p>
          <p className="mt-2 text-sm text-amber-800">
            Varen står på kontorskærmen, indtil den er bestilt.
          </p>
        </div>

        {fejl && <p className="text-sm font-semibold text-red-600">{fejl}</p>}

        <button
          type="button"
          onClick={() => send('bestilt')}
          disabled={travl}
          className="flex items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-4 py-5
                     text-lg font-bold text-white active:bg-emerald-700 disabled:opacity-50"
        >
          <Check size={26} />
          {travl ? 'Sender…' : 'Bestilt — fjern fra skærmen'}
        </button>
      </div>
    )
  }

  return (
    <div className="mt-auto flex flex-col gap-4">
      {fejl && <p className="text-sm font-semibold text-red-600">{fejl}</p>}

      <button
        type="button"
        onClick={() => send('meld')}
        disabled={travl}
        className="flex items-center justify-center gap-3 rounded-2xl bg-red-600 px-4 py-6
                   text-xl font-bold text-white active:bg-red-700 disabled:opacity-50"
      >
        <PackageX size={30} />
        {travl ? 'Sender…' : 'Meld hylden tom'}
      </button>
      <p className="pb-2 text-center text-sm text-gray-500">
        Varen kommer op på kontorskærmen, så den bliver bestilt.
      </p>
    </div>
  )
}

function tidspunkt(iso: string): string {
  return new Intl.DateTimeFormat('da-DK', {
    timeZone: 'Europe/Copenhagen',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}
