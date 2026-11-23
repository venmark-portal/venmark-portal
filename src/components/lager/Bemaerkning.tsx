'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, Square, X } from 'lucide-react'
import { useDiktat } from '@/lib/tale/optager'

const MAKS = 150

/**
 * Bemærkning på en vare — skrevet eller INDTALT.
 *
 * Her vil vi gerne have telefonens rigtige tastatur frem (modsat antallet, hvor vi
 * tegner tasterne selv): det er fritekst, og så skal man have ordforslag og æøå.
 *
 * Diktering bruger browserens egen talegenkendelse. Den findes i Chrome på Android
 * og på en håndterminal med Google-tjenester; findes den ikke, vises knappen slet
 * ikke, og man taster i stedet. Maks 150 tegn — det er hvad der er plads til på
 * kladdelinjen, og hvad nogen gider læse.
 */
export default function Bemaerkning({
  vare,
  start = '',
  titel = 'Bemærkning',
  gemTekst = 'Gem bemærkning',
  placeholder = 'Fx: to kasser står i frostrummet, resten er talt',
  info,
  onGem,
  onLuk,
}: {
  vare: string
  start?: string
  /** Overskriften. Dialogen bruges også til at melde en hylde tom. */
  titel?: string
  gemTekst?: string
  placeholder?: string
  /** Linje over feltet, når brugeren skal vide, hvad trykket udløser. */
  info?: string
  onGem: (tekst: string) => void
  onLuk: () => void
}) {
  const [tekst, setTekst] = useState(start)
  const [lytter, setLytter] = useState(false)
  const [kanTale, setKanTale] = useState(false)
  const [talefejl, setTalefejl] = useState('')
  const genkenderRef = useRef<any>(null)
  // Det der stod i feltet da vi begyndte at lytte, og de færdige stumper vi har fået
  // siden, gemt under hver sit nummer. Ligger uden for React-state, fordi
  // talegenkendelsen fyrer mange gange i sekundet og skal kunne regne teksten forfra
  // hver gang uden at vente på en gentegning.
  const basisRef = useRef('')
  const stumperRef = useRef<string[]>([])
  // Diktat over serveren: hele optagelsen sendes, og varenavnet kommer med som ordbog.
  // Er der ingen nøgle på serveren, falder vi tilbage på browserens egen genkendelse.
  const diktat = useDiktat(
    ny => setTekst(t => [t.trim(), ny.trim()].filter(Boolean).join(' ').slice(0, MAKS)),
    () => vare.split('·').map(s => s.trim()).filter(Boolean),
  )
  // Vil brugeren stadig tale? Browseren lukker mikrofonen af sig selv ved den første
  // pause — og så står man og taler ind i en lukket mikrofon uden at opdage det.
  const villRef = useRef(false)

  useEffect(() => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    setKanTale(!!SR)
    return () => { villRef.current = false; try { genkenderRef.current?.stop() } catch { /* ingen */ } }
  }, [])

  function tal() {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    if (!SR) return
    if (lytter) {
      villRef.current = false
      try { genkenderRef.current?.stop() } catch { /* ingen */ }
      setLytter(false)
      return
    }
    // Luk en gammel genkender HELT ned først. To genkendere i gang samtidig skriver
    // oven i hinanden, og så står teksten dobbelt uanset hvad vi ellers gør.
    if (genkenderRef.current) {
      try {
        genkenderRef.current.onresult = null
        genkenderRef.current.onend = null
        genkenderRef.current.onerror = null
        genkenderRef.current.abort()
      } catch { /* ingen */ }
      genkenderRef.current = null
    }

    const g = new SR()
    g.lang = 'da-DK'
    g.interimResults = true
    // Mikrofonen skal blive ÅBEN, til man selv slukker. Med continuous = false stopper
    // browseren ved den første pause, og alt efter pausen forsvandt uden en lyd:
    // "Jeg skal lige have …10 kg laks mere med" blev til "Jeg skal lige have"
    // (Claus 16-11). Pauser hører med, når man dikterer en bestilling.
    g.continuous = true
    g.maxAlternatives = 1
    basisRef.current = tekst
    stumperRef.current = []
    villRef.current = true
    g.onresult = (e: any) => {
      // Talegenkendelsen sender den SAMME sætning igen og igen mens den retter sig
      // selv undervejs ("to kass…" → "to kasser" → "to kasser står…"). Lægger man
      // hver besked til teksten, står ordene fem-ti gange i feltet.
      // Derfor: gem hver færdig stump under sit nummer, og byg teksten forfra hver
      // gang. Så gør det ingen skade at samme stump kommer flere gange.
      let foreloebig = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const t = String(r?.[0]?.transcript ?? '')
        if (r?.isFinal) stumperRef.current[i] = t
        else foreloebig += t
      }
      const faerdig = stumperRef.current
        .filter(Boolean)
        .join(' ')
      setTekst(
        [basisRef.current, faerdig, foreloebig]
          .map(d => d.trim())
          .filter(Boolean)
          .join(' ')
          .slice(0, MAKS),
      )
    }
    // Fejl må ALDRIG være tavse her. Mikrofon-adgang kan være nægtet, og
    // talegenkendelsen kræver netværk — begge dele ser ud som "der sker ingenting",
    // og så leder man efter fejlen et helt forkert sted.
    g.onerror = (e: any) => {
      // Alle fejl stopper lytningen. Ellers kan genstarten nedenfor køre i ring på en
      // mikrofon der aldrig kommer til at virke.
      villRef.current = false
      setLytter(false)
      const kode = String(e?.error ?? '')
      if (kode === 'not-allowed' || kode === 'service-not-allowed') {
        setTalefejl('Browseren må ikke bruge mikrofonen. Giv adgang i låse-ikonet ved adressen.')
      } else if (kode === 'no-speech') {
        setTalefejl('Hørte ingenting — prøv igen og tal tæt på telefonen.')
      } else if (kode === 'network') {
        setTalefejl('Talegenkendelsen kunne ikke nå nettet.')
      } else if (kode === 'audio-capture') {
        setTalefejl('Ingen mikrofon fundet på enheden.')
      } else if (kode) {
        setTalefejl(`Talegenkendelsen fejlede (${kode}).`)
      }
    }
    g.onend = () => {
      // Browseren lukker også en continuous-lytning efter lang stilhed. Vil brugeren
      // stadig tale, starter vi forfra — men først foldes det færdige ind i basis:
      // en ny lytning tæller resultaterne fra 0 igen, og ellers ville de nye stumper
      // skrive oven i de gamle.
      if (!villRef.current) { setLytter(false); return }
      basisRef.current = [basisRef.current, stumperRef.current.filter(Boolean).join(' ')]
        .map(d => d.trim()).filter(Boolean).join(' ')
      stumperRef.current = []
      try { g.start() } catch { villRef.current = false; setLytter(false) }
    }
    genkenderRef.current = g
    setTalefejl('')
    setLytter(true)
    try {
      g.start()
    } catch (e: any) {
      setLytter(false)
      setTalefejl(`Kunne ikke starte: ${e?.message ?? 'ukendt fejl'}`)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-t-3xl bg-white p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900">{titel}</h2>
            <p className="truncate text-sm text-gray-500">{vare}</p>
          </div>
          <button onClick={onLuk} className="rounded-full bg-gray-100 p-2" aria-label="Luk">
            <X size={18} />
          </button>
        </div>

        {info && (
          <p className="mb-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">{info}</p>
        )}

        <textarea
          value={tekst}
          onChange={e => setTekst(e.target.value.slice(0, MAKS))}
          autoFocus
          rows={3}
          placeholder={placeholder}
          className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base focus:border-emerald-600 focus:outline-none"
        />

        <div className="mt-1 flex items-center justify-between">
          <span className={'text-xs ' + (tekst.length >= MAKS ? 'font-semibold text-amber-700' : 'text-gray-400')}>
            {tekst.length} / {MAKS} tegn
          </span>
          {!kanTale && !diktat.klar && (
            // iPhone og Safari har ingen talegenkendelse i browseren — men iOS' eget
            // tastatur har en mikrofon-tast, og den virker i feltet her.
            <span className="text-xs text-gray-400">Indtal med mikrofonen på dit tastatur</span>
          )}
          {diktat.klar ? (
            // Optag → slip → hele sætningen kommer. Varenavnet sendes med som ordbog,
            // så "10 kg laksefilet" ikke bliver til "10 kW" (Claus 16-11).
            <button
              type="button"
              onClick={() => (diktat.optager ? diktat.stop() : diktat.start())}
              disabled={diktat.skriver}
              className={
                'flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-50 ' +
                (diktat.optager ? 'bg-red-600 text-white' : 'bg-gray-900 text-white')
              }
            >
              {diktat.optager ? <Square size={15} /> : <Mic size={15} />}
              {diktat.optager ? 'Stop' : diktat.skriver ? 'Skriver …' : 'Indtal'}
            </button>
          ) : kanTale && (
            <button
              type="button"
              onClick={tal}
              className={
                'flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold ' +
                (lytter ? 'bg-red-600 text-white' : 'bg-gray-900 text-white')
              }
            >
              {lytter ? <Square size={15} /> : <Mic size={15} />}
              {lytter ? 'Stop' : 'Indtal'}
            </button>
          )}
        </div>

        {(talefejl || diktat.fejl) && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{diktat.fejl || talefejl}</p>
        )}
        {diktat.optager && (
          <p className="mt-2 flex items-center gap-2 text-sm text-red-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
            Optager — tal færdig, og tryk så Stop.
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onGem(tekst.trim())}
            className="flex-1 rounded-xl bg-emerald-700 py-3.5 font-semibold text-white"
          >
            {gemTekst}
          </button>
          {start !== '' && (
            <button
              onClick={() => onGem('')}
              className="rounded-xl px-4 py-3.5 text-sm font-medium text-gray-500"
            >
              Slet
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
