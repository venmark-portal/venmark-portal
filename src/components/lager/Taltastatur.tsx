'use client'

import { Delete } from 'lucide-react'

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
 * Man kan REGNE: 12*3 er hurtigere og mindre fejlbehæftet end at gange tre paller
 * à 12 kasser i hovedet og taste 36. Udtrykket står på skærmen til det gemmes, så
 * man kan se hvad man har tastet — og facit står ved siden af.
 *
 * Knapperne til at gemme ligger IKKE her, men oppe på varekortet ved siden af
 * "Stemmer på …" (Claus 21-11). Taltastaturet ejer teksten, men ikke beslutningen,
 * så tælleskærmen holder sine handlinger samlet ét sted.
 */

const CIFRE = '0123456789'
const REGNETEGN = '+-*/'

/**
 * Regner udtrykket ud. Returnerer null hvis det ikke er et færdigt regnestykke —
 * så er der ikke noget at gemme endnu.
 *
 * Vi tolker selv i stedet for at bruge eval/Function: her kommer tal ind fra en
 * håndterminal, og en tolk der kun kan de fire regnearter kan ikke andet.
 */
export function beregn(tekst: string): number | null {
  const t = tekst.replace(/,/g, '.')
  if (!/^\d+(\.\d+)?([+\-*/]\d+(\.\d+)?)*$/.test(t)) return null

  // Del i tal og regnetegn: "12*3+4" → [12, '*', 3, '+', 4]
  const dele: (number | string)[] = []
  let tal = ''
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (REGNETEGN.includes(c)) { dele.push(Number(tal), c); tal = '' } else tal += c
  }
  dele.push(Number(tal))

  // Gange og dividere først, så plus og minus — ellers bliver 2+3*4 til 20.
  for (let i = 1; i < dele.length; i += 2) {
    const tegn = dele[i] as string
    if (tegn !== '*' && tegn !== '/') continue
    const a = dele[i - 1] as number
    const b = dele[i + 1] as number
    if (tegn === '/' && b === 0) return null
    dele.splice(i - 1, 3, tegn === '*' ? a * b : a / b)
    i -= 2
  }
  let sum = dele[0] as number
  for (let i = 1; i < dele.length; i += 2) {
    const b = dele[i + 1] as number
    sum = (dele[i] as string) === '+' ? sum + b : sum - b
  }
  return Number.isFinite(sum) ? sum : null
}

export default function Taltastatur({
  enhed = '',
  nuvaerende,
  deaktiveret = false,
  fyld = false,
  tekst,
  onTekst,
}: {
  enhed?: string
  /** Hvad der står på varen lige nu — så man kan se hvad man ændrer. */
  nuvaerende?: number
  deaktiveret?: boolean
  /** Strækker tasterne ud i den plads der er tilbage på skærmen, så siden ikke
   *  behøver rulle. Store taster er samtidig dem man rammer med en handske på. */
  fyld?: boolean
  /** Teksten ligger hos tælleskærmen, fordi det er DEN der gemmer. */
  tekst: string
  onTekst: (tekst: string) => void
}) {
  const facit = beregn(tekst)
  const regnestykke = /[+\-*/]/.test(tekst)

  function tryk(t: string) {
    if (deaktiveret) return
    const sidste = tekst.slice(-1)
    if (t === 'slet') { onTekst(tekst.slice(0, -1)); return }
    if (REGNETEGN.includes(t)) {
      // Intet regnetegn uden et tal foran, og aldrig to i træk — det andet
      // afløser bare det første, så man kan fortryde uden at slette.
      if (!tekst) return
      onTekst(REGNETEGN.includes(sidste) || sidste === ',' ? tekst.slice(0, -1) + t : tekst + t)
      return
    }
    if (t === ',') {
      // Kommaet hører til det tal man står i — ikke til hele udtrykket.
      const sidsteTal = tekst.split(/[+\-*/]/).pop() ?? ''
      if (sidsteTal.includes(',')) return
      onTekst(sidsteTal === '' ? tekst + '0,' : tekst + ',')
      return
    }
    // Ingen foranstillede nuller: "007" er ikke et antal nogen mener.
    if (t === '0' && (tekst.split(/[+\-*/]/).pop() ?? '') === '0') return
    onTekst(tekst + t)
  }

  const taster = [
    '7', '8', '9', '/',
    '4', '5', '6', '*',
    '1', '2', '3', '-',
    ',', '0', 'slet', '+',
  ]

  return (
    <div
      className={
        'rounded-2xl bg-white p-2 ring-1 ring-gray-200 ' +
        // Gulv under tastaturet. Uden det giver flex-1 efter for alt det andet på
        // skærmen, og tasterne bliver presset ned til et par millimeter — ulæselige
        // og umulige at ramme. Er der ikke plads, ruller arbejdsområdet i stedet.
        (fyld ? 'flex min-h-[15rem] flex-1 flex-col' : 'mt-3')
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
          {/* Står der et regnestykke, skal facit stå ved siden af — man skal kunne
              se hvad der bliver gemt, FØR man gemmer det. */}
          <span className="text-lg font-semibold tabular-nums text-gray-500">
            {tekst.replace(/\*/g, '×').replace(/\//g, '÷') || '—'}
          </span>
          {regnestykke && facit !== null && (
            <span className="text-2xl font-bold tabular-nums text-gray-900">
              = {facit.toLocaleString('da-DK', { maximumFractionDigits: 3 })}
            </span>
          )}
          {enhed && <span className="text-sm font-medium text-gray-500">{enhed}</span>}
        </span>
      </div>

      <div
        className={
          'grid grid-cols-4 gap-1.5 ' + (fyld ? 'min-h-0 flex-1 auto-rows-fr' : '')
        }
      >
        {taster.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => tryk(t)}
            disabled={deaktiveret}
            aria-label={t === 'slet' ? 'Slet sidste tegn' : t}
            className={
              'rounded-xl text-2xl font-semibold disabled:opacity-30 ' +
              (fyld ? 'h-full min-h-[2.5rem] ' : 'py-3 ') +
              (t === 'slet'
                ? 'bg-gray-200 text-gray-700'
                : REGNETEGN.includes(t)
                  ? 'bg-gray-100 text-gray-700 ring-1 ring-gray-300 active:bg-gray-200'
                  : 'bg-white text-gray-900 ring-1 ring-gray-300 active:bg-gray-100')
            }
          >
            {t === 'slet' ? <Delete size={22} className="mx-auto" />
              : t === '*' ? '×'
                : t === '/' ? '÷'
                  : t}
          </button>
        ))}
      </div>
    </div>
  )
}
