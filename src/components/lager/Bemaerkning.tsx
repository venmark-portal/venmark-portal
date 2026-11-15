'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, Square, X } from 'lucide-react'

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
  onGem,
  onLuk,
}: {
  vare: string
  start?: string
  onGem: (tekst: string) => void
  onLuk: () => void
}) {
  const [tekst, setTekst] = useState(start)
  const [lytter, setLytter] = useState(false)
  const [kanTale, setKanTale] = useState(false)
  const genkenderRef = useRef<any>(null)

  useEffect(() => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    setKanTale(!!SR)
    return () => { try { genkenderRef.current?.stop() } catch { /* ingen */ } }
  }, [])

  function tal() {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    if (!SR) return
    if (lytter) {
      try { genkenderRef.current?.stop() } catch { /* ingen */ }
      setLytter(false)
      return
    }
    const g = new SR()
    g.lang = 'da-DK'
    g.interimResults = true
    g.continuous = false
    g.onresult = (e: any) => {
      let ny = ''
      for (let i = e.resultIndex; i < e.results.length; i++) ny += e.results[i][0].transcript
      // Læg til det der allerede står, så man kan tale i flere omgange.
      setTekst(t => (t ? `${t} ${ny}` : ny).trim().slice(0, MAKS))
    }
    g.onerror = () => setLytter(false)
    g.onend = () => setLytter(false)
    genkenderRef.current = g
    setLytter(true)
    try { g.start() } catch { setLytter(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-t-3xl bg-white p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900">Bemærkning</h2>
            <p className="truncate text-sm text-gray-500">{vare}</p>
          </div>
          <button onClick={onLuk} className="rounded-full bg-gray-100 p-2" aria-label="Luk">
            <X size={18} />
          </button>
        </div>

        <textarea
          value={tekst}
          onChange={e => setTekst(e.target.value.slice(0, MAKS))}
          autoFocus
          rows={3}
          placeholder="Fx: to kasser står i frostrummet, resten er talt"
          className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base focus:border-emerald-600 focus:outline-none"
        />

        <div className="mt-1 flex items-center justify-between">
          <span className={'text-xs ' + (tekst.length >= MAKS ? 'font-semibold text-amber-700' : 'text-gray-400')}>
            {tekst.length} / {MAKS} tegn
          </span>
          {kanTale && (
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

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onGem(tekst.trim())}
            className="flex-1 rounded-xl bg-emerald-700 py-3.5 font-semibold text-white"
          >
            Gem bemærkning
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
