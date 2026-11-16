'use client'

import { useState } from 'react'
import { Check, Delete, Pencil } from 'lucide-react'

/**
 * Appens eget taltastatur. Ligger FAST på tælleskærmen — ikke i en dialog.
 *
 * Telefonens og terminalens egne tastaturer duer ikke her: de skubber skærmen rundt,
 * de forsvinder når scannefeltet rører fokus, og de har små taster til en hånd med
 * handske på. Vi tegner tasterne selv — så ligger de altid samme sted, og ingen
 * anden del af systemet kan tage dem fra os.
 *
 * Tallet man taster SÆTTER antallet på varen. Det er den eneste rækkefølge der ikke
 * overrasker nogen: scanner man en vare og taster 43, står der 43 — ikke 44.
 * Det gælder dog kun ens EGNE registreringer dér hvor man står: flere må gerne tælle
 * den samme vare, og så må den enes tal ikke slette den andens.
 *
 * To måder at gemme på, fordi de betyder noget forskelligt:
 *   Gem antal       = talt. Sådan er der.
 *   Gem som anslået = skøn. Der vejes ikke, så ved tvivl gætter man — men det skal
 *                     kunne ses bagefter, før nogen bogfører på det.
 */
export default function Taltastatur({
  enhed = '',
  nuvaerende,
  deaktiveret = false,
  fyld = false,
  onGem,
}: {
  enhed?: string
  /** Hvad der står på varen lige nu — så man kan se hvad man ændrer. */
  nuvaerende?: number
  deaktiveret?: boolean
  /** Strækker tasterne ud i den plads der er tilbage på skærmen, så siden ikke
   *  behøver rulle. Store taster er samtidig dem man rammer med en handske på. */
  fyld?: boolean
  onGem: (antal: number, anslaaet: boolean) => void
}) {
  const [tekst, setTekst] = useState('')
  const antal = Number(tekst.replace(',', '.'))
  const gyldig = tekst !== '' && Number.isFinite(antal)

  function tryk(t: string) {
    if (deaktiveret) return
    setTekst(v => {
      if (t === 'slet') return v.slice(0, -1)
      if (t === ',') return v.includes(',') ? v : (v === '' ? '0,' : v + ',')
      if (t === '0' && v === '0') return v
      return v + t
    })
  }

  function gem(anslaaet: boolean) {
    if (!gyldig) return
    onGem(antal, anslaaet)
    setTekst('')
  }

  const taster = ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', 'slet']

  return (
    <div
      className={
        'rounded-2xl bg-white p-2 ring-1 ring-gray-200 ' +
        // Gulv under tastaturet. Uden det giver flex-1 efter for alt det andet på
        // skærmen, og tasterne bliver presset ned til et par millimeter — ulæselige
        // og umulige at ramme. Er der ikke plads, ruller arbejdsområdet i stedet.
        (fyld ? 'flex min-h-[17rem] flex-1 flex-col' : 'mt-3')
      }
    >
      {/* Tastaturets display. Lav bjælke — hver millimeter her er en millimeter mindre
          tast. Teksten siger ERSTATTER, fordi det er dét der sker: tallet træder i
          stedet for det talte, det lægges ikke til (Claus spurgte 16-11). */}
      <div className="mb-1.5 flex shrink-0 items-baseline justify-between gap-2 rounded-xl bg-gray-100 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Sæt antal
          {!!nuvaerende && ` · erstatter dine ${nuvaerende.toLocaleString('da-DK', { maximumFractionDigits: 3 })}`}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tabular-nums text-gray-900">{tekst || '—'}</span>
          {enhed && <span className="text-sm font-medium text-gray-500">{enhed}</span>}
        </span>
      </div>

      <div
        className={
          'grid grid-cols-3 gap-2 ' + (fyld ? 'min-h-0 flex-1 auto-rows-fr' : '')
        }
      >
        {taster.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => tryk(t)}
            disabled={deaktiveret}
            className={
              'rounded-xl text-2xl font-semibold disabled:opacity-30 ' +
              (fyld ? 'h-full min-h-[2.75rem] ' : 'py-3.5 ') +
              (t === 'slet'
                ? 'bg-gray-200 text-gray-700'
                : 'bg-white text-gray-900 ring-1 ring-gray-300 active:bg-gray-100')
            }
          >
            {t === 'slet' ? <Delete size={22} className="mx-auto" /> : t}
          </button>
        ))}
      </div>

      <div className="mt-1.5 grid shrink-0 grid-cols-2 gap-2">
        <button
          onClick={() => gem(false)}
          disabled={!gyldig || deaktiveret}
          className="rounded-xl bg-emerald-700 py-2.5 text-base font-semibold text-white disabled:opacity-40"
        >
          <Check size={18} className="mr-1.5 inline" /> Gem antal
        </button>
        <button
          onClick={() => gem(true)}
          disabled={!gyldig || deaktiveret}
          className="rounded-xl bg-amber-600 py-2.5 text-base font-semibold text-white disabled:opacity-40"
        >
          <Pencil size={18} className="mr-1.5 inline" /> Gem som anslået
        </button>
      </div>
    </div>
  )
}
