'use client'

// Ledelsestavle: dag for dag, pakkeri og finans.
//
// Diagrammerne er tegnet i SVG frem for at trække et chart-bibliotek ind —
// figurerne er få og enkle, og serverens build skal ikke vokse for tre kurver.
//
// Farverne er den validerede kategoriske palet i FAST rækkefølge. Farven følger
// personen, ikke placeringen: skifter man periode, så en pakker falder ud,
// beholder de øvrige deres farve. Tre af farverne ligger under 3:1 mod hvid
// baggrund, og derfor er tabelvisningen ikke pynt — den er aflastningen for dem
// der ikke kan skelne farverne.

import { useMemo, useState } from 'react'

// ─── Palet (valideret kategorisk rækkefølge, lys baggrund) ──────────────────
const SERIE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const BLAEK      = '#0b0b0b'
const BLAEK_2    = '#52514e'
const DAEMPET    = '#898781'
const GITTER     = '#e1e0d9'
const BASISLINJE = '#c3c2b7'
const LUKKET_BG  = 'rgba(137,135,129,0.14)'

// ─── Typer (spejler src/lib/tidslinjer.ts) ──────────────────────────────────
interface PakkerDag { pakker: string; linjer: number; scannet: number; timer: number | null }
interface PakkeriDag {
  dato: string; ugedag: number; linjer: number; scannet: number
  timer: number | null; pakkere: PakkerDag[]
}
interface PakkeriData { dage: PakkeriDag[]; pakkere: string[]; starter: string | null; mangler?: string; fejl?: string }

interface FinansPunkt { dato: string; ugedag: number; omsaetning: number; enheder: number }
interface FinansDag extends FinansPunkt {
  fakturaer: number
  /** 52 uger tilbage — samme ugedag. Det er den sammenligning figurerne viser. */
  sidsteAar: FinansPunkt | null
  /** Samme dato sidste år — kun i tabellen. */
  sammeDato: FinansPunkt | null
  lukket?: string
  lukketSidsteAar?: string
}
type FinansData = FinansDag[] | { fejl: string }

export interface TidslinjeSvar {
  fra: string; til: string
  finans: FinansData
  pakkeri: PakkeriData
}

// ─── Formatering ─────────────────────────────────────────────────────────────
const kr  = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 })
const en1 = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 })

function kortDato(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}
function ugedagNavn(n: number): string {
  return ['', 'man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'][n] ?? ''
}

/** Pæne akse-trin: 1, 2, 5 × 10^n — så tallene på aksen er til at læse. */
function aksetrin(maks: number, oenskede = 4): number[] {
  if (maks <= 0) return [0]
  const raat = maks / oenskede
  const eksp = Math.pow(10, Math.floor(Math.log10(raat)))
  const trin = [1, 2, 2.5, 5, 10].map(f => f * eksp).find(f => f >= raat) ?? 10 * eksp
  const ud: number[] = []
  for (let v = 0; v <= maks + trin * 0.001; v += trin) ud.push(v)
  return ud
}

// ─── Diagram-ramme ───────────────────────────────────────────────────────────

const M = { top: 12, hoejre: 12, bund: 26, venstre: 52 }
const B = 720   // intern bredde; SVG'en skalerer med viewBox
const H = 190

function Ramme({
  titel, undertitel, children, tom,
}: { titel: string; undertitel?: string; children: React.ReactNode; tom?: string }) {
  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
      <h3 className="text-sm font-semibold text-gray-900">{titel}</h3>
      {undertitel && <p className="mt-0.5 text-xs text-gray-500">{undertitel}</p>}
      <div className="mt-3">
        {tom ? <p className="py-8 text-center text-sm text-gray-400">{tom}</p> : children}
      </div>
    </section>
  )
}

function Forklaring({ navne, farve }: { navne: string[]; farve: (n: string) => string }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
      {navne.map(n => (
        <span key={n} className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: farve(n) }} />
          {n}
        </span>
      ))}
    </div>
  )
}

/** Y-akse med gitter. Gitteret er med vilje sart — det skal ikke slås om opmærksomheden. */
function YAkse({ trin, hoejde, format }: { trin: number[]; hoejde: number; format: (v: number) => string }) {
  const maks = trin[trin.length - 1] || 1
  return (
    <>
      {trin.map(v => {
        const y = M.top + hoejde - (v / maks) * hoejde
        return (
          <g key={v}>
            <line x1={M.venstre} x2={B - M.hoejre} y1={y} y2={y} stroke={GITTER} strokeWidth={1} />
            <text x={M.venstre - 8} y={y + 3.5} textAnchor="end" fontSize={10} fill={DAEMPET}
                  style={{ fontVariantNumeric: 'tabular-nums' }}>
              {format(v)}
            </text>
          </g>
        )
      })}
    </>
  )
}

function XAkse({ datoer, hoejde, lukkede }: { datoer: string[]; hoejde: number; lukkede?: Set<string> }) {
  const n = datoer.length
  const spring = Math.max(1, Math.ceil(n / 12))
  const bredde = (B - M.venstre - M.hoejre) / Math.max(1, n)
  return (
    <>
      <line x1={M.venstre} x2={B - M.hoejre} y1={M.top + hoejde} y2={M.top + hoejde}
            stroke={BASISLINJE} strokeWidth={1} />
      {datoer.map((d, i) => {
        if (i % spring !== 0) return null
        const x = M.venstre + bredde * (i + 0.5)
        return (
          <text key={d} x={x} y={M.top + hoejde + 15} textAnchor="middle" fontSize={10}
                fill={lukkede?.has(d) ? BLAEK_2 : DAEMPET}
                style={{ fontVariantNumeric: 'tabular-nums' }}>
            {kortDato(d)}
          </text>
        )
      })}
    </>
  )
}

/** Markering af lukkedage, så en nul-dag ikke læses som en katastrofe. */
function Lukkemarkering({ datoer, lukkede, hoejde }: { datoer: string[]; lukkede: Map<string, string>; hoejde: number }) {
  const bredde = (B - M.venstre - M.hoejre) / Math.max(1, datoer.length)
  return (
    <>
      {datoer.map((d, i) => lukkede.has(d) ? (
        <rect key={d} x={M.venstre + bredde * i} y={M.top} width={bredde} height={hoejde} fill={LUKKET_BG} />
      ) : null)}
    </>
  )
}

// ─── Stakket søjlediagram ────────────────────────────────────────────────────

function StakketSoejler({
  datoer, serier, farve, format, lukkede,
}: {
  datoer: string[]
  serier: { navn: string; vaerdier: number[] }[]
  farve: (n: string) => string
  format: (v: number) => string
  lukkede?: Map<string, string>
}) {
  const [over, setOver] = useState<number | null>(null)
  const hoejde = H - M.top - M.bund
  const totaler = datoer.map((_, i) => serier.reduce((s, r) => s + (r.vaerdier[i] ?? 0), 0))
  const trin = aksetrin(Math.max(...totaler, 1))
  const maks = trin[trin.length - 1] || 1
  const kolonne = (B - M.venstre - M.hoejre) / Math.max(1, datoer.length)
  const soejle = Math.min(kolonne * 0.62, 26)

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${B} ${H}`} className="w-full" style={{ height: 'auto' }} role="img">
        {lukkede && <Lukkemarkering datoer={datoer} lukkede={lukkede} hoejde={hoejde} />}
        <YAkse trin={trin} hoejde={hoejde} format={format} />
        <XAkse datoer={datoer} hoejde={hoejde} lukkede={lukkede ? new Set(lukkede.keys()) : undefined} />

        {datoer.map((d, i) => {
          const x = M.venstre + kolonne * (i + 0.5) - soejle / 2
          let y = M.top + hoejde
          return (
            <g key={d}
               onMouseEnter={() => setOver(i)} onMouseLeave={() => setOver(null)}>
              {/* Rammen om kolonnen er hit-fladen — større end søjlen selv. */}
              <rect x={M.venstre + kolonne * i} y={M.top} width={kolonne} height={hoejde}
                    fill={over === i ? 'rgba(11,11,11,0.035)' : 'transparent'} />
              {serier.map((r, si) => {
                const v = r.vaerdier[i] ?? 0
                if (v <= 0) return null
                const h = (v / maks) * hoejde
                y -= h
                // 2px mellemrum mellem segmenter, så stakken kan læses.
                const synlig = Math.max(0, h - 2)
                const erTop  = serier.slice(si + 1).every(s => (s.vaerdier[i] ?? 0) <= 0)
                return (
                  <rect key={r.navn} x={x} y={y} width={soejle} height={synlig}
                        rx={erTop ? 4 : 0} ry={erTop ? 4 : 0}
                        fill={farve(r.navn)} />
                )
              })}
            </g>
          )
        })}
      </svg>

      {over !== null && (
        <Skybrik
          venstre={(M.venstre + kolonne * (over + 0.5)) / B}
          titel={`${kortDato(datoer[over])} ${ugedagNavn(new Date(`${datoer[over]}T12:00:00Z`).getUTCDay() || 7)}`}
          note={lukkede?.get(datoer[over])}
          raekker={serier
            .map(r => ({ navn: r.navn, vaerdi: r.vaerdier[over] ?? 0, farve: farve(r.navn) }))
            .filter(r => r.vaerdi > 0)
            .sort((a, b) => b.vaerdi - a.vaerdi)}
          sum={{ navn: 'I alt', vaerdi: totaler[over] }}
          format={format}
        />
      )}
    </div>
  )
}

// ─── Linjediagram ────────────────────────────────────────────────────────────

function Linjer({
  datoer, serier, farve, format, lukkede, nulErTomt,
}: {
  datoer: string[]
  serier: { navn: string; vaerdier: (number | null)[] }[]
  farve: (n: string) => string
  format: (v: number) => string
  lukkede?: Map<string, string>
  /** Vis ikke en nul-værdi som et punkt på gulvet — den betyder "ingen data". */
  nulErTomt?: boolean
}) {
  const [over, setOver] = useState<number | null>(null)
  const hoejde = H - M.top - M.bund
  const alle = serier.flatMap(s => s.vaerdier).filter((v): v is number => v !== null && (!nulErTomt || v > 0))
  const trin = aksetrin(Math.max(...alle, 1))
  const maks = trin[trin.length - 1] || 1
  const kolonne = (B - M.venstre - M.hoejre) / Math.max(1, datoer.length)
  const xAf = (i: number) => M.venstre + kolonne * (i + 0.5)
  const yAf = (v: number) => M.top + hoejde - (v / maks) * hoejde

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${B} ${H}`} className="w-full" style={{ height: 'auto' }} role="img"
           onMouseLeave={() => setOver(null)}>
        {lukkede && <Lukkemarkering datoer={datoer} lukkede={lukkede} hoejde={hoejde} />}
        <YAkse trin={trin} hoejde={hoejde} format={format} />
        <XAkse datoer={datoer} hoejde={hoejde} lukkede={lukkede ? new Set(lukkede.keys()) : undefined} />

        {over !== null && (
          <line x1={xAf(over)} x2={xAf(over)} y1={M.top} y2={M.top + hoejde}
                stroke={BASISLINJE} strokeWidth={1} />
        )}

        {serier.map(r => {
          // Huller brydes i stedet for at blive tegnet igennem: en dag uden data
          // er ikke en dag med nul.
          const stykker: string[] = []
          let nu: string[] = []
          r.vaerdier.forEach((v, i) => {
            const tom = v === null || (nulErTomt && v === 0)
            if (tom) { if (nu.length) { stykker.push(nu.join(' ')); nu = [] } return }
            nu.push(`${nu.length ? 'L' : 'M'}${xAf(i)} ${yAf(v as number)}`)
          })
          if (nu.length) stykker.push(nu.join(' '))
          return (
            <g key={r.navn}>
              {stykker.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={farve(r.navn)} strokeWidth={2}
                      strokeLinecap="round" strokeLinejoin="round" />
              ))}
              {over !== null && r.vaerdier[over] !== null && !(nulErTomt && r.vaerdier[over] === 0) && (
                // 2px ring i baggrundsfarven, så punktet kan ses oven på en anden kurve.
                <circle cx={xAf(over)} cy={yAf(r.vaerdier[over] as number)} r={4.5}
                        fill={farve(r.navn)} stroke="#ffffff" strokeWidth={2} />
              )}
            </g>
          )
        })}

        {datoer.map((d, i) => (
          <rect key={d} x={M.venstre + kolonne * i} y={M.top} width={kolonne} height={hoejde}
                fill="transparent" onMouseEnter={() => setOver(i)} />
        ))}
      </svg>

      {over !== null && (
        <Skybrik
          venstre={xAf(over) / B}
          titel={`${kortDato(datoer[over])} ${ugedagNavn(new Date(`${datoer[over]}T12:00:00Z`).getUTCDay() || 7)}`}
          note={lukkede?.get(datoer[over])}
          raekker={serier
            .filter(r => r.vaerdier[over] !== null)
            .map(r => ({ navn: r.navn, vaerdi: r.vaerdier[over] as number, farve: farve(r.navn) }))}
          format={format}
        />
      )}
    </div>
  )
}

// ─── Skybrik (tooltip) ───────────────────────────────────────────────────────

function Skybrik({
  venstre, titel, note, raekker, sum, format,
}: {
  venstre: number
  titel: string
  note?: string
  raekker: { navn: string; vaerdi: number; farve: string }[]
  sum?: { navn: string; vaerdi: number }
  format: (v: number) => string
}) {
  const hoejre = venstre > 0.62
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 min-w-[9rem] rounded-lg bg-white/97 p-2.5 shadow-lg ring-1 ring-gray-200"
      style={hoejre ? { right: `${(1 - venstre) * 100 + 2}%` } : { left: `${venstre * 100 + 2}%` }}
    >
      <div className="text-xs font-semibold text-gray-900">{titel}</div>
      {note && <div className="mt-0.5 text-[11px] font-medium text-gray-500">{note}</div>}
      <div className="mt-1.5 space-y-0.5">
        {raekker.map(r => (
          <div key={r.navn} className="flex items-baseline gap-2 text-[11px]">
            <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: r.farve }} />
            <span className="min-w-0 flex-1 truncate text-gray-600">{r.navn}</span>
            <span className="font-semibold tabular-nums text-gray-900">{format(r.vaerdi)}</span>
          </div>
        ))}
        {sum && (
          <div className="mt-1 flex items-baseline gap-2 border-t border-gray-200 pt-1 text-[11px]">
            <span className="min-w-0 flex-1 text-gray-600">{sum.navn}</span>
            <span className="font-semibold tabular-nums text-gray-900">{format(sum.vaerdi)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tavlen ──────────────────────────────────────────────────────────────────

export default function Tidslinjer({ data, fra, til }: { data: TidslinjeSvar; fra: string; til: string }) {
  const [visTabel, setVisTabel] = useState(false)

  const pakkeri = data.pakkeri
  const finans  = Array.isArray(data.finans) ? data.finans : null
  const finansFejl = !Array.isArray(data.finans) ? data.finans.fejl : null

  // Farve følger PERSONEN. Rækkefølgen er alfabetisk og dermed stabil — skifter
  // man periode, repainter de overlevende ikke.
  const farveAf = useMemo(() => {
    const kort = new Map<string, string>()
    pakkeri.pakkere?.forEach((n, i) => kort.set(n, SERIE[i % SERIE.length]))
    return (n: string) => kort.get(n) ?? SERIE[0]
  }, [pakkeri.pakkere])

  const faste = (n: string) => (n === 'I år' ? SERIE[0] : n === 'Sidste år' ? SERIE[1] : SERIE[2])

  // ── Pakkeri-serier ──
  const pDatoer = pakkeri.dage?.map(d => d.dato) ?? []
  const pSerier = (pakkeri.pakkere ?? []).map(navn => ({
    navn,
    vaerdier: pakkeri.dage.map(d => d.pakkere.find(p => p.pakker === navn)?.linjer ?? 0),
  }))
  const timerSerie = [{ navn: 'Timer', vaerdier: pakkeri.dage?.map(d => d.timer) ?? [] }]
  const prTimeSerie = [{
    navn: 'Linjer pr. time',
    vaerdier: pakkeri.dage?.map(d => (d.timer && d.timer > 0 ? Math.round(d.linjer / d.timer) : null)) ?? [],
  }]
  const scanSerier = [
    { navn: 'Alle samlet', vaerdier: pakkeri.dage?.map(d => d.linjer > 0 ? Math.round((d.scannet / d.linjer) * 100) : null) ?? [] },
    ...(pakkeri.pakkere ?? []).map(navn => ({
      navn,
      vaerdier: pakkeri.dage.map(d => {
        const p = d.pakkere.find(x => x.pakker === navn)
        return p && p.linjer > 0 ? Math.round((p.scannet / p.linjer) * 100) : null
      }),
    })),
  ]

  // ── Finans-serier ──
  const fDatoer = finans?.map(d => d.dato) ?? []
  const lukkede = new Map<string, string>()
  finans?.forEach(d => { if (d.lukket) lukkede.set(d.dato, d.lukket) })

  const omsSerier = [
    { navn: 'I år',       vaerdier: finans?.map(d => d.omsaetning) ?? [] },
    { navn: 'Sidste år',  vaerdier: finans?.map(d => d.sidsteAar?.omsaetning ?? null) ?? [] },
  ]
  const enhSerier = [
    { navn: 'I år',       vaerdier: finans?.map(d => d.enheder) ?? [] },
    { navn: 'Sidste år',  vaerdier: finans?.map(d => d.sidsteAar?.enheder ?? null) ?? [] },
  ]

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const omsIAlt   = sum(finans?.map(d => d.omsaetning) ?? [])
  const omsSidste = sum(finans?.map(d => d.sidsteAar?.omsaetning ?? 0) ?? [])
  const vaekst    = omsSidste > 0 ? Math.round(((omsIAlt - omsSidste) / omsSidste) * 100) : null

  return (
    <div className="space-y-4">

      {/* ── Filtre: én række over diagrammerne ── */}
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 ring-1 ring-gray-200">
        <label className="text-xs font-medium text-gray-600">
          Fra
          <input type="date" name="fra" defaultValue={fra}
                 className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-medium text-gray-600">
          Til
          <input type="date" name="til" defaultValue={til}
                 className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <button type="submit"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          Vis
        </button>
        <div className="ml-auto flex items-center gap-2">
          {[[14, '14 dage'], [30, '30 dage'], [90, '90 dage']].map(([n, tekst]) => (
            <a key={String(n)} href={`?dage=${n}`}
               className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              {tekst as string}
            </a>
          ))}
          <button type="button" onClick={() => setVisTabel(v => !v)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            {visTabel ? 'Skjul tal' : 'Vis tal'}
          </button>
        </div>
      </form>

      {/* ── Finans ── */}
      <h2 className="pt-1 text-base font-bold text-gray-900">Omsætning</h2>

      {finansFejl ? (
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          Kunne ikke hentes: {finansFejl}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Noegletal titel="Omsætning i perioden" vaerdi={`${kr.format(omsIAlt)} kr.`} />
            <Noegletal titel="Samme periode sidste år" vaerdi={`${kr.format(omsSidste)} kr.`} />
            <Noegletal
              titel="Udvikling"
              vaerdi={vaekst === null ? '—' : `${vaekst > 0 ? '+' : ''}${vaekst} %`}
              farve={vaekst === null ? undefined : vaekst >= 0 ? '#006300' : '#d03b3b'}
            />
          </div>

          <Ramme
            titel="Omsætning pr. dag — i år mod sidste år"
            undertitel="Faktureret beløb ekskl. moms. Sammenlignet med SAMME UGEDAG sidste år (52 uger tilbage), fordi ugedagen afgør alt i fisk — fredag mod torsdag ville ikke sige noget. Grå baggrund = lukkedag."
            tom={fDatoer.length === 0 ? 'Ingen dage i perioden.' : undefined}
          >
            <Linjer datoer={fDatoer} serier={omsSerier} farve={faste}
                    format={v => kr.format(v)} lukkede={lukkede} nulErTomt />
            <Forklaring navne={['I år', 'Sidste år']} farve={faste} />
          </Ramme>

          <Ramme
            titel="Antal enheder pr. dag"
            undertitel="Solgte enheder på fakturalinjerne — vist for sig, fordi kroner og enheder ikke kan dele akse."
            tom={fDatoer.length === 0 ? 'Ingen dage i perioden.' : undefined}
          >
            <Linjer datoer={fDatoer} serier={enhSerier} farve={faste}
                    format={v => en1.format(v)} lukkede={lukkede} nulErTomt />
            <Forklaring navne={['I år', 'Sidste år']} farve={faste} />
          </Ramme>
        </>
      )}

      {/* ── Pakkeri ── */}
      <h2 className="pt-2 text-base font-bold text-gray-900">Pakkeri</h2>

      {pakkeri.fejl || pakkeri.mangler ? (
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          {pakkeri.fejl ?? pakkeri.mangler}
        </div>
      ) : pDatoer.length === 0 ? (
        <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">
          Ingen pakkedata i perioden. Loggen skriver først fra 14-09-2026 — før den dato findes tallene ikke.
        </div>
      ) : (
        <>
          <Ramme
            titel="Linjer pakket pr. dag"
            undertitel="Stablet pr. pakker. Hold musen over en dag for fordelingen."
          >
            <StakketSoejler datoer={pDatoer} serier={pSerier} farve={farveAf} format={v => kr.format(v)} />
            <Forklaring navne={pakkeri.pakkere} farve={farveAf} />
          </Ramme>

          <div className="grid gap-4 lg:grid-cols-2">
            <Ramme
              titel="Stemplede timer i pakkeriet"
              undertitel="Dan-Time job 16. Dage uden sampling vises som hul, ikke som nul."
            >
              <Linjer datoer={pDatoer} serier={timerSerie} farve={() => SERIE[0]} format={v => en1.format(v)} />
            </Ramme>

            <Ramme
              titel="Linjer pr. stemplet arbejdstime"
              undertitel="Afdelingens produktivitet — kan ikke brydes ned pr. person, se noten nederst."
            >
              <Linjer datoer={pDatoer} serier={prTimeSerie} farve={() => SERIE[2]} format={v => kr.format(v)} />
            </Ramme>
          </div>

          <Ramme
            titel="Andel scannet"
            undertitel="Linjer hvor kasserne blev scannet, i procent. Resten er meldt pakket i hånden."
          >
            <Linjer datoer={pDatoer} serier={scanSerier} farve={n => n === 'Alle samlet' ? BLAEK : farveAf(n)}
                    format={v => `${v} %`} />
            <Forklaring navne={['Alle samlet', ...pakkeri.pakkere]}
                        farve={n => n === 'Alle samlet' ? BLAEK : farveAf(n)} />
          </Ramme>
        </>
      )}

      {/* ── Tabelvisning: aflastning for farverne, og tallene til at tage med ── */}
      {visTabel && (
        <>
          {pDatoer.length > 0 && (
            <Tabel
              titel="Pakkeri dag for dag"
              hoveder={['Dato', 'Ugedag', 'Linjer', 'Scannet', '%', 'Timer', 'Pr. time',
                        ...pakkeri.pakkere.flatMap(n => [n, `${n} t`, `${n} /t`])]}
              raekker={pakkeri.dage.map(d => [
                kortDato(d.dato), ugedagNavn(d.ugedag), kr.format(d.linjer), kr.format(d.scannet),
                d.linjer ? `${Math.round((d.scannet / d.linjer) * 100)} %` : '—',
                d.timer !== null ? en1.format(d.timer) : '—',
                d.timer ? kr.format(Math.round(d.linjer / d.timer)) : '—',
                ...pakkeri.pakkere.flatMap(n => {
                  const p = d.pakkere.find(x => x.pakker === n)
                  if (!p) return ['—', '—', '—']
                  return [
                    kr.format(p.linjer),
                    p.timer !== null ? en1.format(p.timer) : '—',
                    // Personens egne linjer delt med personens egne stemplede timer.
                    // Uden koblingen i admin er timerne ukendte, og så står der en streg
                    // frem for et tal der ville se rigtigt ud.
                    p.timer ? kr.format(Math.round(p.linjer / p.timer)) : '—',
                  ]
                }),
              ])}
            />
          )}
          {finans && (
            <Tabel
              titel="Omsætning dag for dag"
              hoveder={['Dato', 'Ugedag', 'Omsætning', 'Enheder', 'Fakturaer',
                        'Samme ugedag sidste år', 'Dato', 'Samme dato sidste år', 'Note']}
              raekker={finans.map(d => [
                kortDato(d.dato), ugedagNavn(d.ugedag), kr.format(d.omsaetning), en1.format(d.enheder),
                kr.format(d.fakturaer),
                d.sidsteAar ? kr.format(d.sidsteAar.omsaetning) : '—',
                d.sidsteAar ? kortDato(d.sidsteAar.dato) : '—',
                // Samme dato er med for fuldstændighedens skyld — den rammer en anden
                // ugedag og er derfor ikke den sammenligning figurerne bygger på.
                d.sammeDato ? `${kr.format(d.sammeDato.omsaetning)} (${ugedagNavn(d.sammeDato.ugedag)})` : '—',
                [d.lukket, d.lukketSidsteAar && `sidste år: ${d.lukketSidsteAar}`].filter(Boolean).join(' · ') || '',
              ])}
            />
          )}
        </>
      )}
    </div>
  )
}

function Noegletal({ titel, vaerdi, farve }: { titel: string; vaerdi: string; farve?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{titel}</div>
      <div className="mt-1 text-2xl font-bold" style={{ color: farve ?? BLAEK }}>{vaerdi}</div>
    </div>
  )
}

function Tabel({ titel, hoveder, raekker }: { titel: string; hoveder: string[]; raekker: string[][] }) {
  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">{titel}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              {hoveder.map(h => <th key={h} className="px-2 py-1.5 font-medium whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {raekker.map((r, i) => (
              <tr key={i} className="border-b border-gray-100">
                {r.map((c, j) => (
                  <td key={j} className="px-2 py-1.5 tabular-nums whitespace-nowrap text-gray-800">{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
