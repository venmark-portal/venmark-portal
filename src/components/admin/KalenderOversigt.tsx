'use client'

// Tre måneder frem, alle kalendere. Grupperet pr. dag, fordi det er sådan man
// leder: "hvad sker der på torsdag", ikke "hvad har Line i kalenderen".
// Personfilteret er til den anden slags spørgsmål.

import { useMemo, useState } from 'react'

interface Aftale {
  id: string; person: string; emne: string
  start: string; slut: string; heledag: boolean; sted: string; aflyst: boolean
}
interface KalenderSvar { aftaler: Aftale[]; personer: string[]; mangler?: string }

// Samme validerede kategoriske rækkefølge som tidslinjerne — farven følger
// personen, så den er den samme uanset hvem der ellers er med i filteret.
const SERIE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

const UGEDAGE = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør']

function dagNavn(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  const [y, m, dd] = iso.split('-')
  return `${UGEDAGE[d.getUTCDay()]} ${dd}/${m}`
}

export default function KalenderOversigt({
  data, fra, maaneder,
}: { data: KalenderSvar; fra: string; maaneder: number }) {
  const [person, setPerson] = useState<string>('')
  const [søg, setSøg] = useState('')

  const farveAf = useMemo(() => {
    const kort = new Map<string, string>()
    data.personer.forEach((p, i) => kort.set(p, SERIE[i % SERIE.length]))
    return (p: string) => kort.get(p) ?? SERIE[0]
  }, [data.personer])

  const idag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date())

  const dage = useMemo(() => {
    const q = søg.trim().toLowerCase()
    const filtreret = data.aftaler.filter(a =>
      (!person || a.person === person) &&
      (!q || a.emne.toLowerCase().includes(q) || a.sted.toLowerCase().includes(q) || a.person.toLowerCase().includes(q)),
    )
    const kort = new Map<string, Aftale[]>()
    for (const a of filtreret) {
      const d = a.start.slice(0, 10)
      if (!d) continue
      ;(kort.get(d) ?? kort.set(d, []).get(d)!).push(a)
    }
    return Array.from(kort.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [data.aftaler, person, søg])

  if (data.mangler) {
    return (
      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
        Kunne ikke hentes: {data.mangler}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 ring-1 ring-gray-200">
        <label className="text-xs font-medium text-gray-600">
          Person
          <select value={person} onChange={e => setPerson(e.target.value)}
                  className="mt-1 block w-56 rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">Alle ({data.personer.length})</option>
            {data.personer.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          Søg
          <input value={søg} onChange={e => setSøg(e.target.value)} placeholder="emne, sted eller person"
                 className="mt-1 block w-64 rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <div className="ml-auto flex items-center gap-2">
          {[1, 3, 6, 12].map(n => (
            <a key={n} href={`?fra=${fra}&maaneder=${n}`}
               className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                 n === maaneder
                   ? 'border-blue-300 bg-blue-50 text-blue-700'
                   : 'border-gray-300 text-gray-700 hover:bg-gray-50'
               }`}>
              {n} {n === 1 ? 'måned' : 'mdr'}
            </a>
          ))}
        </div>
      </div>

      {dage.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-400 ring-1 ring-gray-200">
          Ingen aftaler i perioden.
        </p>
      ) : (
        <div className="space-y-3">
          {dage.map(([dag, aftaler]) => (
            <section key={dag} className="rounded-xl bg-white ring-1 ring-gray-200">
              <h2 className={`border-b border-gray-100 px-4 py-2 text-sm font-semibold ${
                dag === idag ? 'text-blue-700' : 'text-gray-900'
              }`}>
                {dagNavn(dag)}{dag === idag && ' · i dag'}
                <span className="ml-2 font-normal text-gray-400">{aftaler.length}</span>
              </h2>
              {aftaler.map(a => (
                <div key={a.id + a.person} className="flex items-baseline gap-3 border-b border-gray-50 px-4 py-1.5 last:border-0">
                  <span className="w-28 shrink-0 text-sm font-semibold tabular-nums text-gray-900">
                    {a.heledag ? 'hele dagen' : `${a.start.slice(11, 16)}–${a.slut.slice(11, 16)}`}
                  </span>
                  <span className="flex w-44 shrink-0 items-center gap-1.5 truncate text-xs text-gray-600" title={a.person}>
                    <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: farveAf(a.person) }} />
                    {a.person}
                  </span>
                  <span className={`min-w-0 flex-1 text-sm ${a.aflyst ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                    {a.emne}
                    {a.sted && <span className="text-gray-400"> · {a.sted}</span>}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
