'use client'

import { useState } from 'react'
import { Check, Delete, Pencil } from 'lucide-react'

/**
 * Appens eget taltastatur.
 *
 * Telefonens og terminalens egne tastaturer duer ikke her: de skubber skærmen rundt,
 * de forsvinder når scannefeltet rører fokus, og de har små taster til en hånd med
 * handske på. Vi tegner tasterne selv — så ligger de altid samme sted, og der er
 * ingen anden del af systemet der kan tage dem fra os.
 *
 * To måder at gemme på, fordi de betyder noget forskelligt:
 *   Gem antal   = talt. Det er sådan her der er.
 *   Gem som anslået = skøn. Der vejes ikke, så ved tvivl gætter man — men det skal
 *                     kunne ses bagefter, før nogen bogfører på det.
 */
export default function Taltastatur({
  titel,
  undertekst,
  startVaerdi = '',
  enhed = '',
  onGem,
  onLuk,
}: {
  titel: string
  undertekst?: string
  startVaerdi?: string
  enhed?: string
  onGem: (antal: number, anslaaet: boolean) => void
  onLuk: () => void
}) {
  const [tekst, setTekst] = useState(startVaerdi)
  const antal = Number(tekst.replace(',', '.'))
  const gyldig = tekst !== '' && Number.isFinite(antal)

  function tryk(t: string) {
    setTekst(v => {
      if (t === 'slet') return v.slice(0, -1)
      if (t === ',') return v.includes(',') ? v : (v === '' ? '0,' : v + ',')
      if (t === '0' && v === '0') return v
      return v + t
    })
  }

  const taster = ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', 'slet']

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-t-3xl bg-white p-4 pb-5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900">{titel}</h2>
            {undertekst && <p className="truncate text-sm text-gray-500">{undertekst}</p>}
          </div>
          <button onClick={onLuk} className="shrink-0 px-2 py-1 text-sm text-gray-500">
            Luk
          </button>
        </div>

        <div className="mb-3 flex items-baseline justify-end gap-2 rounded-2xl bg-gray-100 px-4 py-4">
          <span className="text-4xl font-bold tabular-nums text-gray-900">{tekst || '0'}</span>
          {enhed && <span className="text-lg font-medium text-gray-500">{enhed}</span>}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {taster.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => tryk(t)}
              className={
                'rounded-2xl py-4 text-2xl font-semibold ' +
                (t === 'slet'
                  ? 'bg-gray-200 text-gray-700'
                  : 'bg-white text-gray-900 ring-1 ring-gray-300 active:bg-gray-100')
              }
            >
              {t === 'slet' ? <Delete size={22} className="mx-auto" /> : t}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => onGem(antal, false)}
            disabled={!gyldig}
            className="rounded-2xl bg-emerald-700 py-4 text-base font-semibold text-white disabled:opacity-40"
          >
            <Check size={18} className="mr-1.5 inline" /> Gem antal
          </button>
          <button
            onClick={() => onGem(antal, true)}
            disabled={!gyldig}
            className="rounded-2xl bg-amber-600 py-4 text-base font-semibold text-white disabled:opacity-40"
          >
            <Pencil size={18} className="mr-1.5 inline" /> Gem som anslået
          </button>
        </div>
      </div>
    </div>
  )
}
