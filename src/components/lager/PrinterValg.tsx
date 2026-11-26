'use client'

import { Check, X } from 'lucide-react'

export interface PrinterRaekke {
  id: string
  navn: string
  beskrivelse: string
}

export interface PrinterValgt {
  printerId: string
  printerNavn: string
}

/**
 * Vælg printer. Samme dialog på alle lager-skærme, der printer — ligger den to steder,
 * ender den med at opføre sig to måder, og så er det umuligt at svare på hvorfor
 * printeren huskes på den ene skærm og ikke den anden.
 *
 * Valget gemmes i portalens DB pr. bruger (PUT /api/lager/print), ikke i BC: alle
 * terminaler kalder BC ind som OAuth-appen, så BC's eget "min printer" ville ramme
 * appen og ikke manden med terminalen.
 */
export default function PrinterValg({
  printere,
  valg,
  onVaelg,
  onLuk,
}: {
  printere: PrinterRaekke[]
  valg: PrinterValgt | null
  onVaelg: (p: PrinterRaekke) => void
  onLuk: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onLuk}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-t-3xl bg-gray-100 p-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-1 flex shrink-0 items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Vælg printer</h2>
            <p className="text-xs text-gray-500">
              Den huskes, indtil du vælger en anden — fx hvis du flytter sted.
            </p>
          </div>
          <button onClick={onLuk} className="shrink-0 rounded-full bg-white p-2 ring-1 ring-gray-300" aria-label="Luk">
            <X size={18} />
          </button>
        </div>
        {printere.length === 0 && (
          // Ikke en tom liste uden forklaring: er der ingen printere, er det BC's
          // printerregister der er tomt, og så er det ikke appen der er i vejen.
          <p className="mt-2 rounded-xl bg-white p-3 text-sm text-gray-700 ring-1 ring-gray-200">
            BC har ingen printere registreret. Det er PrintNode-opsætningen i BC, der
            skal have dem — ikke appen.
          </p>
        )}
        <ul className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {printere.map(p => (
            <li key={p.id}>
              <button
                onClick={() => onVaelg(p)}
                className="flex w-full items-center justify-between gap-2 rounded-2xl bg-white p-3 text-left ring-1 ring-gray-200"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-gray-900">{p.navn}</span>
                  {p.beskrivelse && (
                    <span className="block truncate text-xs text-gray-500">{p.beskrivelse}</span>
                  )}
                </span>
                {valg?.printerId === p.id && <Check size={18} className="shrink-0 text-emerald-700" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
