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

// Skrevet af frem for importeret fra src/lib/telefoni: dén fil trækker prisma med,
// og den hører ikke hjemme i browserens bundt. Holdes i sync med IKKE_FORDELT dér.
const IKKE_FORDELT = 'Ikke fordelt'
// Samme for UDEN_SAELGER i src/lib/tidslinjer.
const UDEN_SAELGER = 'Ingen sælger'

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
  timer: number | null; timerKoblede: number; linjerKoblede: number
  pakkere: PakkerDag[]
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

interface TelefonPersonDag { navn: string; opkald: number; ind: number; ud: number; minutter: number }
interface TelefonDag {
  dato: string; ugedag: number
  opkald: number; ind: number; ud: number; minutter: number
  ubesvarede: number; ventMedian: number | null
  personer: TelefonPersonDag[]
}
interface TelefonNummer {
  nummer: string; opkald: number; ind: number; ud: number
  minutter: number; sidst: string; fuldt: boolean
  kunde?: string; kundeNr?: string; kontakt?: string; leverandoer?: boolean
}
interface TelefonData {
  dage: TelefonDag[]; personer: string[]
  numre?: TelefonNummer[]; udenNummer?: number
  mangler?: string; fejl?: string
}

interface SaelgerDag { kode: string; linjer: number; hurtig: number }
interface SalgDag { dato: string; ugedag: number; linjer: number; saelgere: SaelgerDag[] }
interface SalgData { dage: SalgDag[]; saelgere: string[]; mangler?: string; fejl?: string }

interface ProdAfdeling {
  jobNr: string; jobNavn: string; produktioner: number
  raaKg: number; outKg: number; timer: number
  raaPrTime: number | null; outPrTime: number | null; udbytte: number | null
  personer: { navn: string; timer: number }[]
  advarsel?: string
}
interface ProdDag {
  dato: string; ugedag: number; daekket: boolean; timerIAlt: number
  afdelinger: { jobNr: string; raaKg: number; outKg: number; timer: number }[]
}
interface ProduktionData {
  dage: ProdDag[]; afdelinger: ProdAfdeling[]
  udenJob: { produktioner: number; raaKg: number; outKg: number }
  udaekkede: string[]; timerFra: string | null
  mangler?: string; fejl?: string
}

export interface TidslinjeSvar {
  fra: string; til: string
  finans: FinansData
  pakkeri: PakkeriData
  telefon: TelefonData
  salg?: SalgData
  produktion?: ProduktionData
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

/** Pænt trin: 1, 2, 2.5, 5 × 10^n — så tallene på aksen er til at læse. */
function pentTrin(spaend: number, oenskede = 4): number {
  const raat = Math.abs(spaend) / oenskede
  if (raat <= 0) return 1
  const eksp = Math.pow(10, Math.floor(Math.log10(raat)))
  return [1, 2, 2.5, 5, 10].map(f => f * eksp).find(f => f >= raat) ?? 10 * eksp
}

function aksetrin(maks: number, oenskede = 4): number[] {
  if (maks <= 0) return [0]
  const trin = pentTrin(maks, oenskede)
  const ud: number[] = []
  for (let v = 0; v <= maks + trin * 0.001; v += trin) ud.push(v)
  return ud
}

/**
 * Akse over et frit interval — til indekstal, hvor bunden ikke er nul men
 * skalaen skal rumme sammenligningspunktet (100 = som sidste år).
 *
 * Starter man sådan en akse i nul, bliver al variation trykket sammen i toppen
 * og man kan ikke se forskel på en god og en dårlig dag.
 */
/**
 * Glidende gennemsnit over de seneste `vindue` punkter.
 *
 * Omsætningen svinger voldsomt efter ugedag — mandag og onsdag er tre gange
 * fredag — så den rå kurve er en savklinge man ikke kan læse en retning ud af.
 * Gennemsnittet over halvanden handelsuge udjævner ugerytmen og viser niveauet.
 *
 * Bevidst BAGUDRETTET og ikke centreret: et centreret gennemsnit kan ikke
 * beregnes for de sidste dage, og det er netop dem man kigger på. Til gengæld
 * reagerer kurven lidt forsinket.
 */
function glidende(vaerdier: (number | null)[], vindue: number): (number | null)[] {
  return vaerdier.map((_, i) => {
    if (i + 1 < vindue) return null
    const vindu = vaerdier.slice(i + 1 - vindue, i + 1).filter((v): v is number => v !== null && v > 0)
    // Er mere end en tredjedel af vinduet hul, siger gennemsnittet ikke noget.
    if (vindu.length < Math.ceil(vindue * 0.67)) return null
    return Math.round(vindu.reduce((a, b) => a + b, 0) / vindu.length)
  })
}

function aksetrinInterval(lav: number, hoej: number, oenskede = 4): number[] {
  const trin = pentTrin((hoej - lav) || 1, oenskede)
  const fra = Math.floor(lav / trin) * trin
  const til = Math.ceil(hoej / trin) * trin
  const ud: number[] = []
  for (let v = fra; v <= til + trin * 0.001; v += trin) ud.push(Math.round(v * 1e6) / 1e6)
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
function YAkse({ trin, hoejde, format, reference }: {
  trin: number[]; hoejde: number; format: (v: number) => string
  /** Værdi der markeres kraftigere — fx 100 = som sidste år. */
  reference?: number
}) {
  const lav  = trin[0] ?? 0
  const hoej = trin[trin.length - 1] || 1
  const spaend = (hoej - lav) || 1
  return (
    <>
      {trin.map(v => {
        const y = M.top + hoejde - ((v - lav) / spaend) * hoejde
        // Sammenligningsgrundlaget skal kunne ses tydeligere end gitteret —
        // ellers ved man ikke hvad der er over og under.
        const erNul = reference !== undefined && v === reference
        return (
          <g key={v}>
            <line x1={M.venstre} x2={B - M.hoejre} y1={y} y2={y}
                  stroke={erNul ? BASISLINJE : GITTER} strokeWidth={erNul ? 1.5 : 1} />
            <text x={M.venstre - 8} y={y + 3.5} textAnchor="end" fontSize={10}
                  fill={erNul ? BLAEK_2 : DAEMPET}
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
  datoer, serier, farve, format, lukkede, nulErTomt, reference,
}: {
  datoer: string[]
  serier: { navn: string; vaerdier: (number | null)[] }[]
  farve: (n: string) => string
  format: (v: number) => string
  lukkede?: Map<string, string>
  /** Vis ikke en nul-værdi som et punkt på gulvet — den betyder "ingen data". */
  nulErTomt?: boolean
  /**
   * Sammenligningsværdi (fx 100 = som sidste år). Sat, spænder aksen over
   * dataene OG dette punkt i stedet for at starte i nul, og linjen markeres.
   */
  reference?: number
}) {
  const [over, setOver] = useState<number | null>(null)
  const hoejde = H - M.top - M.bund
  const alle = serier.flatMap(s => s.vaerdier)
    .filter((v): v is number => v !== null && (!nulErTomt || v !== 0))
  const trin = reference !== undefined
    ? aksetrinInterval(Math.min(...alle, reference), Math.max(...alle, reference))
    : aksetrin(Math.max(...alle.filter(v => v > 0), 1))
  const lav    = trin[0] ?? 0
  const hoej   = trin[trin.length - 1] || 1
  const spaend = (hoej - lav) || 1
  const kolonne = (B - M.venstre - M.hoejre) / Math.max(1, datoer.length)
  const xAf = (i: number) => M.venstre + kolonne * (i + 0.5)
  const yAf = (v: number) => M.top + hoejde - ((v - lav) / spaend) * hoejde

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${B} ${H}`} className="w-full" style={{ height: 'auto' }} role="img"
           onMouseLeave={() => setOver(null)}>
        {lukkede && <Lukkemarkering datoer={datoer} lukkede={lukkede} hoejde={hoejde} />}
        <YAkse trin={trin} hoejde={hoejde} format={format} reference={reference} />
        <XAkse datoer={datoer} hoejde={hoejde} lukkede={lukkede ? new Set(lukkede.keys()) : undefined} />

        {/* Sammenligningslinjen tegnes for sig. Den må ikke afhænge af om 100
            tilfældigvis rammer et akse-trin — gør den ikke det, ville selve
            grundlaget for figuren være usynligt. */}
        {reference !== undefined && !trin.includes(reference) && (
          <line x1={M.venstre} x2={B - M.hoejre} y1={yAf(reference)} y2={yAf(reference)}
                stroke={BASISLINJE} strokeWidth={1.5} />
        )}

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
            // En nul-værdi kan betyde "ingen data" (omsætning) eller "præcis som
            // sidste år" (afvigelse). På en signeret akse er nul en ægte værdi.
            const tom = v === null || (nulErTomt && reference === undefined && v === 0)
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
              {over !== null && r.vaerdier[over] !== null && !(nulErTomt && reference === undefined && r.vaerdier[over] === 0) && (
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

  // ── Telefon ──
  // Egen farveskala: det er en anden gruppe mennesker end pakkerne, og en delt
  // skala ville give to personer samme farve uden at betyde noget.
  const telefon = data.telefon ?? { dage: [], personer: [] }
  // "Ikke fordelt" er ikke en person — den får grå, så den ikke læses som en
  // medarbejder med flest opkald, og så den ikke bruger en af de otte hues.
  const tFarveAf = useMemo(() => {
    const kort = new Map<string, string>()
    let i = 0
    telefon.personer?.forEach(n => {
      if (n === IKKE_FORDELT) kort.set(n, DAEMPET)
      else kort.set(n, SERIE[i++ % SERIE.length])
    })
    return (n: string) => kort.get(n) ?? SERIE[0]
  }, [telefon.personer])

  // ── Salg pr. sælger ──
  // Egen farveskala igen: sælgerkoder er en tredje gruppe. "Ingen sælger" er grå.
  const salg = data.salg ?? { dage: [], saelgere: [] }
  const sFarveAf = useMemo(() => {
    const kort = new Map<string, string>()
    let i = 0
    salg.saelgere?.forEach(n => {
      if (n === UDEN_SAELGER) kort.set(n, DAEMPET)
      else kort.set(n, SERIE[i++ % SERIE.length])
    })
    return (n: string) => kort.get(n) ?? SERIE[0]
  }, [salg.saelgere])
  const sDatoer = salg.dage?.map(d => d.dato) ?? []
  const sAntalSerier = (salg.saelgere ?? []).map(kode => ({
    navn: kode,
    vaerdier: salg.dage.map(d => d.saelgere.find(s => s.kode === kode)?.linjer ?? 0),
  }))
  // Andel af DAGENS linjer — så en stille dag og en travl dag kan sammenlignes.
  const sPctSerier = (salg.saelgere ?? []).map(kode => ({
    navn: kode,
    vaerdier: salg.dage.map(d => {
      const n = d.saelgere.find(s => s.kode === kode)?.linjer ?? 0
      return d.linjer > 0 ? Math.round((n / d.linjer) * 1000) / 10 : 0
    }),
  }))
  const sLinjerIAlt = salg.dage?.reduce((s, d) => s + d.linjer, 0) ?? 0
  const sSaelgerSum = (salg.saelgere ?? []).map(kode => {
    let linjer = 0, hurtig = 0, dage = 0
    for (const d of salg.dage ?? []) {
      const s = d.saelgere.find(x => x.kode === kode)
      if (!s) continue
      linjer += s.linjer; hurtig += s.hurtig; dage++
    }
    return { kode, linjer, hurtig, dage }
  }).sort((a, b) => b.linjer - a.linjer)
  const sPortal = sSaelgerSum.find(s => s.kode.toUpperCase() === 'PORTAL')?.linjer ?? 0

  const tDatoer = telefon.dage?.map(d => d.dato) ?? []
  // Antal og taletid er to forskellige enheder og får derfor hver sin figur —
  // aldrig to y-akser i samme diagram.
  const tOpkaldSerier = (telefon.personer ?? []).map(navn => ({
    navn,
    vaerdier: telefon.dage.map(d => d.personer.find(p => p.navn === navn)?.opkald ?? 0),
  }))
  const tMinutSerier = (telefon.personer ?? []).map(navn => ({
    navn,
    vaerdier: telefon.dage.map(d => d.personer.find(p => p.navn === navn)?.minutter ?? 0),
  }))
  const tSvarSerie = [{
    navn: 'Svartid',
    vaerdier: telefon.dage.map(d => d.ventMedian),
  }]

  const tOpkaldIAlt = telefon.dage?.reduce((s, d) => s + d.opkald, 0) ?? 0
  const tMinutIAlt  = telefon.dage?.reduce((s, d) => s + d.minutter, 0) ?? 0
  const tUbesvarede = telefon.dage?.reduce((s, d) => s + d.ubesvarede, 0) ?? 0
  const tDageMed    = telefon.dage?.filter(d => d.opkald > 0).length ?? 0

  // ── Produktion ──
  // Farve følger afdelingen (jobnummeret), i den rækkefølge listen står i.
  const produktion = data.produktion ?? {
    dage: [], afdelinger: [], udenJob: { produktioner: 0, raaKg: 0, outKg: 0 }, udaekkede: [], timerFra: null,
  }
  const prFarveAf = useMemo(() => {
    const kort = new Map<string, string>()
    produktion.afdelinger?.forEach((a, i) => kort.set(a.jobNavn, SERIE[i % SERIE.length]))
    return (n: string) => kort.get(n) ?? DAEMPET
  }, [produktion.afdelinger])
  const prDatoer = produktion.dage?.map(d => d.dato) ?? []
  // Udækkede dage skygges som lukkedage: kiloene er der, timerne mangler.
  const prUdaekket = new Map((produktion.dage ?? []).filter(d => !d.daekket)
    .map(d => [d.dato, `Dan-Time mangler timer (${en1.format(d.timerIAlt)} t stemplet)`]))
  const prAfd = produktion.afdelinger ?? []
  const prDagJob = (d: ProdDag, jobNr: string) => d.afdelinger.find(x => x.jobNr === jobNr)
  const prRaaSerier = prAfd.map(a => ({
    navn: a.jobNavn, vaerdier: produktion.dage.map(d => prDagJob(d, a.jobNr)?.raaKg ?? 0),
  }))
  const prPrTime = (felt: 'raaKg' | 'outKg') => prAfd
    .filter(a => felt === 'outKg' || a.raaPrTime !== null)
    .map(a => ({
      navn: a.jobNavn,
      vaerdier: produktion.dage.map(d => {
        const x = prDagJob(d, a.jobNr)
        return d.daekket && x && x.timer > 0 && x[felt] > 0 ? Math.round(x[felt] / x.timer) : null
      }),
    }))
  const prRaaPrTime = prPrTime('raaKg')
  const prOutPrTime = prPrTime('outKg')
  // Samlede forholdstal: afdelinger hvor råvaren ikke bogføres, er taget ud af
  // BÅDE tæller og nævner for råvare-tallet — ellers trækker deres timer det ned.
  const prMedRaa   = prAfd.filter(a => a.raaPrTime !== null)
  const prRaaIAlt  = prAfd.reduce((s, a) => s + a.raaKg, 0)
  const prOutIAlt  = prAfd.reduce((s, a) => s + a.outKg, 0)
  const prTimerIAlt = prAfd.reduce((s, a) => s + a.timer, 0)
  const prRaaRate  = (() => {
    const t = prMedRaa.reduce((s, a) => s + a.timer, 0)
    return t > 0 ? prMedRaa.reduce((s, a) => s + a.raaKg, 0) / t : null
  })()
  const prOutRate  = prTimerIAlt > 0 ? prOutIAlt / prTimerIAlt : null
  const [prAaben, setPrAaben] = useState<string | null>(null)

  // Hele måneder som genveje — det er sådan tallene typisk efterspørges.
  const maaneder = (() => {
    const [y, m] = til.split('-').map(Number)
    return [0, 1, 2, 3].map(n => {
      const d = new Date(Date.UTC(y, m - 1 - n, 1))
      const sidste = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      return {
        navn: d.toLocaleDateString('da-DK', { month: 'short', timeZone: 'UTC' }).replace('.', ''),
        fra: d.toISOString().slice(0, 10), til: sidste.toISOString().slice(0, 10),
      }
    }).reverse()
  })()

  // ── Pakkeri-serier ──
  const pDatoer = pakkeri.dage?.map(d => d.dato) ?? []
  const pSerier = (pakkeri.pakkere ?? []).map(navn => ({
    navn,
    vaerdier: pakkeri.dage.map(d => d.pakkere.find(p => p.pakker === navn)?.linjer ?? 0),
  }))
  const timerSerie = [{ navn: 'Timer', vaerdier: pakkeri.dage?.map(d => d.timer) ?? [] }]
  // Samme mennesker i tæller og nævner: kun de pakkere der både er koblet til
  // en pakkerkode OG har stemplet ind. JAN, HÅKON og LINE pakker uden at være i
  // Dan-Time, så deres linjer må ikke lægges oven i andres timer.
  const prTimeSerie = [{
    navn: 'Linjer pr. time',
    vaerdier: pakkeri.dage?.map(d =>
      d.timerKoblede > 0 ? Math.round(d.linjerKoblede / d.timerKoblede) : null) ?? [],
  }]
  // Hvor stor en del af dagens linjer raten overhovedet dækker.
  const daekning = (() => {
    const l = (pakkeri.dage ?? []).reduce((s, d) => s + d.linjer, 0)
    const k = (pakkeri.dage ?? []).reduce((s, d) => s + d.linjerKoblede, 0)
    return l > 0 ? Math.round((k / l) * 100) : null
  })()

  // Linjer pr. arbejdstime PR. PAKKER. Kun dem der stempler har timer, så kun de
  // navne optræder — en pakker uden stempling ville ellers få en kurve der så
  // beregnet ud uden at være det.
  const medTimer = (pakkeri.pakkere ?? []).filter(n =>
    (pakkeri.dage ?? []).some(d => {
      const p = d.pakkere.find(x => x.pakker === n)
      return p && p.timer !== null && p.timer > 0
    }))
  const prTimePrPakker = medTimer.map(navn => ({
    navn,
    vaerdier: pakkeri.dage.map(d => {
      const p = d.pakkere.find(x => x.pakker === navn)
      return p && p.timer && p.timer > 0 ? Math.round(p.linjer / p.timer) : null
    }),
  }))
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

  // Vinduet er 7 HANDELSDAGE, ikke kalenderdage — weekender er allerede sorteret
  // fra, så syv punkter er halvanden arbejdsuge og dækker ugerytmen.
  const VINDUE = 7
  const omsIAar = finans?.map(d => d.omsaetning) ?? []
  const omsSerier = [
    { navn: 'I år',       vaerdier: omsIAar },
    { navn: 'Sidste år',  vaerdier: finans?.map(d => d.sidsteAar?.omsaetning ?? null) ?? [] },
    { navn: `Tendens (${VINDUE} dage)`, vaerdier: glidende(omsIAar, VINDUE) },
  ]
  const omsFarve = (n: string) =>
    n === 'I år' ? SERIE[0] : n === 'Sidste år' ? SERIE[1] : SERIE[2]
  const enhSerier = [
    { navn: 'I år',       vaerdier: finans?.map(d => d.enheder) ?? [] },
    { navn: 'Sidste år',  vaerdier: finans?.map(d => d.sidsteAar?.enheder ?? null) ?? [] },
  ]

  // Indeks mod samme ugedag sidste år: i år delt med sidste år, gange 100.
  // 100 = præcis som sidste år, 150 = halvanden gang så meget, 50 = halvdelen.
  //
  // Kroner og enheder kan DELE akse her, netop fordi begge er indekstal — det er
  // den ene gang to forskellige målestokke hører hjemme i samme figur.
  //
  // To slags værdier luges væk frem for at blive tegnet:
  //   over 300 %  — en enkelt stor ordre mod en stille dag sidste år giver
  //                 udsving på tusinder af procent, og så bliver resten af
  //                 kurven en flad streg langs bunden.
  //   under 0 %   — kan kun opstå hvis et af tallene er negativt (kreditvægt),
  //                 og et negativt indeks betyder ingenting.
  // Et indekstal kan kun læses hvis BEGGE sider har rigtig handel bag sig.
  // Reglerne, i den rækkefølge de rammer:
  //   · mangler en af siderne helt      → ingen sammenligning
  //   · under 25 % eller over 300 %     → det er ikke en udvikling, det er en
  //                                       datafejl (fx en enkelt bulkordre mod
  //                                       en stille dag), og den flader resten ud
  // Rammer ÉN af de to målestokke ud over båndet, ryger HELE dagen — vi kan ikke
  // vide hvilken af dem der er den forkerte, og en enlig kurve inviterer til at
  // drage en konklusion af et tal vi netop har mistillid til.
  const GULV = 25
  const LOFT = 300
  const raat = (nu: number, saa: number | undefined | null): number | null =>
    saa === undefined || saa === null || saa <= 0 || nu <= 0 ? null : Math.round((nu / saa) * 100)

  const dagOk = (d: FinansDag): boolean => {
    const o = raat(d.omsaetning, d.sidsteAar?.omsaetning)
    const e = raat(d.enheder,    d.sidsteAar?.enheder)
    if (o === null || e === null) return false
    return o >= GULV && o <= LOFT && e >= GULV && e <= LOFT
  }

  const pctSerier = [
    { navn: 'Omsætning', vaerdier: finans?.map(d => dagOk(d) ? raat(d.omsaetning, d.sidsteAar?.omsaetning) : null) ?? [] },
    { navn: 'Kilo',      vaerdier: finans?.map(d => dagOk(d) ? raat(d.enheder,    d.sidsteAar?.enheder)    : null) ?? [] },
  ]
  const pctFarve = (n: string) => (n === 'Omsætning' ? SERIE[0] : SERIE[1])
  const lugede = (finans ?? []).filter(d => !dagOk(d)).length

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const omsIAlt   = sum(finans?.map(d => d.omsaetning) ?? [])
  const omsSidste = sum(finans?.map(d => d.sidsteAar?.omsaetning ?? 0) ?? [])
  // Samme målestok som figuren: 100 % = som sidste år. To forskellige tal for
  // det samme ville kun forvirre.
  const vaekst    = omsSidste > 0 ? Math.round((omsIAlt / omsSidste) * 100) : null

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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {maaneder.map(m => (
            <a key={m.fra} href={`?fra=${m.fra}&til=${m.til}`}
               className={'rounded-lg border px-3 py-1.5 text-xs font-medium capitalize hover:bg-gray-50 ' +
                 (fra === m.fra && til === m.til ? 'border-blue-600 text-blue-700' : 'border-gray-300 text-gray-700')}>
              {m.navn}
            </a>
          ))}
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
              titel="I år i forhold til sidste år"
              vaerdi={vaekst === null ? '—' : `${vaekst} %`}
              farve={vaekst === null ? undefined : vaekst >= 100 ? '#006300' : '#d03b3b'}
            />
          </div>

          <Ramme
            titel="Omsætning pr. dag — i år mod sidste år"
            undertitel={`Faktureret beløb ekskl. moms. Sammenlignet med SAMME UGEDAG sidste år (52 uger tilbage), fordi ugedagen afgør alt i fisk — fredag mod torsdag ville ikke sige noget. Tendenslinjen er gennemsnittet af de seneste ${VINDUE} handelsdage; den udjævner ugerytmen, hvor mandag kan være tre gange fredag. Dage uden omsætning i nogen af årene er udeladt. Grå baggrund = lukkedag.`}
            tom={fDatoer.length === 0 ? 'Ingen dage i perioden.' : undefined}
          >
            <Linjer datoer={fDatoer} serier={omsSerier} farve={omsFarve}
                    format={v => kr.format(v)} lukkede={lukkede} nulErTomt />
            <Forklaring navne={['I år', 'Sidste år', `Tendens (${VINDUE} dage)`]} farve={omsFarve} />
          </Ramme>

          <Ramme
            titel="I år i forhold til sidste år — omsætning og kilo"
            undertitel={
              'I år delt med samme ugedag sidste år. 100 % er stregen: samme som sidste år. ' +
              'Kroner og kilo må dele akse her, fordi begge er indekstal — ligger de langt ' +
              'fra hinanden, er prisen flyttet sig og ikke mængden. ' +
              'Dage uden handel i et af årene er udeladt, og det samme er dage under 25 % ' +
              'eller over 300 %: dér er det en datafejl og ikke en udvikling.' +
              (lugede > 0 ? ` ${lugede} ${lugede === 1 ? 'dag' : 'dage'} udeladt i perioden.` : '')
            }
            tom={fDatoer.length === 0 ? 'Ingen dage i perioden.' : undefined}
          >
            <Linjer datoer={fDatoer} serier={pctSerier} farve={pctFarve}
                    format={v => `${v} %`} lukkede={lukkede} reference={100} />
            <Forklaring navne={['Omsætning', 'Kilo']} farve={pctFarve} />
          </Ramme>

          <Ramme
            titel="Solgte kilo pr. dag"
            undertitel="Mængde omregnet til varens basisenhed, så kartoner, spande og stykker tæller med i den rigtige størrelse. Samme forskydning som omsætningen — mod samme ugedag sidste år. Vist for sig, fordi kroner og kilo ikke kan dele akse."
            tom={fDatoer.length === 0 ? 'Ingen dage i perioden.' : undefined}
          >
            <Linjer datoer={fDatoer} serier={enhSerier} farve={faste}
                    format={v => en1.format(v)} lukkede={lukkede} nulErTomt />
            <Forklaring navne={['I år', 'Sidste år']} farve={faste} />
          </Ramme>
        </>
      )}

      {/* ── Salg pr. sælger ── */}
      <h2 className="pt-2 text-base font-bold text-gray-900">Salgslinjer pr. sælger</h2>

      {salg.fejl || salg.mangler ? (
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          {salg.fejl ?? salg.mangler}
        </div>
      ) : sDatoer.length === 0 ? (
        <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">
          Ingen salgslinjer i perioden. Loggen skriver først fra 14-09-2026.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Noegletal titel="Linjer i alt" vaerdi={kr.format(sLinjerIAlt)} />
            <Noegletal titel="Linjer pr. dag" vaerdi={kr.format(Math.round(sLinjerIAlt / sDatoer.length))} />
            <Noegletal titel="Sælgere" vaerdi={kr.format(sSaelgerSum.filter(s => s.kode !== UDEN_SAELGER && !['PORTAL', 'NETFISK'].includes(s.kode.toUpperCase())).length)} />
            <Noegletal titel="Andel fra portalen"
                       vaerdi={sLinjerIAlt ? `${en1.format((sPortal / sLinjerIAlt) * 100)} %` : '—'} />
          </div>

          <Ramme
            titel="Salgslinjer pr. dag"
            undertitel="Oprettede ordrelinjer, stablet pr. sælgerkode. Dagen er den dag linjen blev tastet — ikke afsendelsesdagen. Linjer der blev slettet igen tæller ikke. Portal = kundernes egne webordrer, Netfisk = webshoppen (før stod de som debitorens faste sælger). Hold musen over en dag for fordelingen."
          >
            <StakketSoejler datoer={sDatoer} serier={sAntalSerier} farve={sFarveAf} format={v => kr.format(v)} />
            <Forklaring navne={salg.saelgere} farve={sFarveAf} />
          </Ramme>

          <Ramme
            titel="Andel af dagens linjer pr. sælger"
            undertitel="Hver søjle er 100 % = alle dagens linjer. Viser fordelingen uafhængigt af om dagen var travl eller stille."
          >
            <StakketSoejler datoer={sDatoer} serier={sPctSerier} farve={sFarveAf} format={v => `${en1.format(v)} %`} />
            <Forklaring navne={salg.saelgere} farve={sFarveAf} />
          </Ramme>

          <Tabel
            titel="Sælgere i perioden"
            hoveder={['Sælger', 'Linjer', 'Andel', 'Dage med salg', 'Linjer pr. dag', 'Hurtig indtastning']}
            raekker={sSaelgerSum.map(s => [
              s.kode,
              kr.format(s.linjer),
              sLinjerIAlt ? `${en1.format((s.linjer / sLinjerIAlt) * 100)} %` : '—',
              kr.format(s.dage),
              s.dage ? en1.format(s.linjer / s.dage) : '—',
              s.linjer ? `${Math.round((s.hurtig / s.linjer) * 100)} %` : '—',
            ])}
          />
        </>
      )}

      {/* ── Telefon ── */}
      <h2 className="pt-2 text-base font-bold text-gray-900">Telefon</h2>

      {telefon.fejl || telefon.mangler ? (
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          {telefon.fejl ?? telefon.mangler}
        </div>
      ) : tDatoer.length === 0 ? (
        <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">
          Ingen opkald i perioden.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Noegletal titel="Opkald i alt" vaerdi={kr.format(tOpkaldIAlt)} />
            <Noegletal titel="Taletid" vaerdi={`${kr.format(Math.round(tMinutIAlt / 60))} t`} />
            <Noegletal titel="Opkald pr. dag" vaerdi={tDageMed ? kr.format(Math.round(tOpkaldIAlt / tDageMed)) : '—'} />
            <Noegletal
              titel="Ubesvarede"
              vaerdi={kr.format(tUbesvarede)}
              // Status-rød, ikke en farve fra serie-paletten: den er reserveret til
              // at kende personer fra hinanden og må ikke komme til at betyde "dårligt".
              farve={tUbesvarede > 0 ? '#d03b3b' : undefined}
            />
          </div>

          <Ramme
            titel="Opkald pr. dag"
            undertitel="Stablet pr. medarbejder — den der tog telefonen. Grå er opkald gennem omstillingen hvor vi ikke kan se hvem der tog den. Hold musen over en dag for fordelingen."
          >
            <StakketSoejler datoer={tDatoer} serier={tOpkaldSerier} farve={tFarveAf} format={v => kr.format(v)} />
            <Forklaring navne={telefon.personer} farve={tFarveAf} />
          </Ramme>

          <Ramme
            titel="Taletid pr. dag"
            undertitel="Minutter, stablet pr. medarbejder. Egen figur frem for en ekstra akse — minutter og antal kan ikke læses på samme målestok."
          >
            <StakketSoejler datoer={tDatoer} serier={tMinutSerier} farve={tFarveAf} format={v => `${kr.format(v)} min`} />
            <Forklaring navne={telefon.personer} farve={tFarveAf} />
          </Ramme>

          {(telefon.numre?.length ?? 0) > 0 && (
            <Tabel
              titel={`Numre vi taler mest med${telefon.udenNummer ? ` — ${kr.format(telefon.udenNummer)} opkald i perioden har intet nummer gemt` : ''}`}
              hoveder={['Kunde', 'Kontaktperson', 'Konto', 'Nummer', 'Opkald', 'Ind', 'Ud', 'Minutter', 'Seneste']}
              raekker={(telefon.numre ?? []).map(n => [
                // Tom kunde = nummeret står hverken på en debitor, kontakt, leveringsadresse
                // eller leverandør i BC — typisk en chauffør eller en privat.
                n.kunde ? (n.leverandoer ? `${n.kunde} (leverandør)` : n.kunde) : '—',
                n.kontakt || '',
                n.kundeNr || '—',
                // Et nummer med stjerner er Microsofts maskering: de sidste cifre
                // kunne ikke hentes, typisk fordi opkaldet er ældre end 30 dage.
                n.fuldt ? n.nummer : `${n.nummer} (delvist)`,
                kr.format(n.opkald), kr.format(n.ind), kr.format(n.ud),
                kr.format(n.minutter), kortDato(n.sidst),
              ])}
            />
          )}

          <Ramme
            titel="Svartid på indgående opkald"
            undertitel="Median i sekunder — hvor længe kunden ventede, før nogen tog den. Dage uden målte opkald vises som hul."
          >
            <Linjer datoer={tDatoer} serier={tSvarSerie} farve={() => SERIE[3]}
                    format={v => `${kr.format(v)} s`} nulErTomt />
          </Ramme>
        </>
      )}

      <h2 className="pt-2 text-base font-bold text-gray-900">Produktion — kg pr. mandetime</h2>

      {produktion.fejl || produktion.mangler ? (
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          {produktion.fejl ?? produktion.mangler}
        </div>
      ) : prAfd.length === 0 ? (
        <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">
          Ingen afsluttede montager med både kg og stemplede timer i perioden.
          {produktion.timerFra && ` Dan-Time-timerne findes fra ${kortDato(produktion.timerFra)}-${produktion.timerFra.slice(0, 4)}.`}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Noegletal titel="Råvare" vaerdi={`${kr.format(prRaaIAlt)} kg`} />
            <Noegletal titel="Output" vaerdi={`${kr.format(prOutIAlt)} kg`} />
            <Noegletal titel="Mandetimer" vaerdi={kr.format(prTimerIAlt)} />
            <Noegletal titel="Kg pr. mandetime"
                       vaerdi={`${prRaaRate !== null ? kr.format(prRaaRate) : '—'} / ${prOutRate !== null ? kr.format(prOutRate) : '—'}`} />
          </div>
          <p className="-mt-1 text-xs text-gray-500">
            Kg pr. mandetime står som <strong>råvare / output</strong>.
            {produktion.udaekkede.length > 0 && (
              <> Dage hvor Dan-Time ikke har timerne, er taget ud af tallene (skygget i figurerne):{' '}
                {produktion.udaekkede.map(kortDato).join(', ')}.</>
            )}
            {produktion.timerFra && fra < produktion.timerFra && (
              <> Dan-Time-timerne findes først fra {kortDato(produktion.timerFra)}-{produktion.timerFra.slice(0, 4)}; dagene før tæller ikke.</>
            )}
          </p>

          <section className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">Pr. afdeling</h3>
            <p className="mt-0.5 text-xs text-gray-500">Afdeling = Dan-Time-job på montagen. Tryk på en afdeling for at se hvem der har stået der.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    {['Afdeling', 'Montager', 'Råvare kg', 'Output kg', 'Udbytte', 'Mandetimer', 'Råvare kg/t', 'Output kg/t', 'Personer']
                      .map((h, i) => <th key={h} className={'px-2 py-1.5 font-medium whitespace-nowrap ' + (i ? 'text-right' : '')}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {prAfd.map(a => {
                    const aaben = prAaben === a.jobNr
                    return [
                      <tr key={a.jobNr} onClick={() => setPrAaben(aaben ? null : a.jobNr)}
                          className="cursor-pointer border-b border-gray-100 tabular-nums hover:bg-gray-50">
                        <td className="px-2 py-2 whitespace-nowrap text-gray-900">
                          <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: prFarveAf(a.jobNavn) }} />
                          <span className="text-gray-400">{a.jobNr}</span> {a.jobNavn}
                          <span className="ml-1 text-xs text-gray-400">{aaben ? '▾' : '▸'}</span>
                          {a.advarsel && <div className="mt-0.5 text-xs text-amber-700">{a.advarsel}</div>}
                        </td>
                        <td className="px-2 py-2 text-right">{kr.format(a.produktioner)}</td>
                        <td className="px-2 py-2 text-right">{kr.format(a.raaKg)}</td>
                        <td className="px-2 py-2 text-right">{kr.format(a.outKg)}</td>
                        <td className="px-2 py-2 text-right">{a.udbytte !== null ? `${en1.format(a.udbytte)} %` : '—'}</td>
                        <td className="px-2 py-2 text-right">{en1.format(a.timer)}</td>
                        <td className="px-2 py-2 text-right font-semibold text-gray-900">{a.raaPrTime !== null ? en1.format(a.raaPrTime) : '—'}</td>
                        <td className="px-2 py-2 text-right font-semibold text-gray-900">{a.outPrTime !== null ? en1.format(a.outPrTime) : '—'}</td>
                        <td className="px-2 py-2 text-right">{a.personer.length}</td>
                      </tr>,
                      aaben && (
                        <tr key={`${a.jobNr}-folk`} className="border-b border-gray-100 bg-gray-50">
                          <td colSpan={9} className="px-2 py-2">
                            <ul className="flex flex-wrap gap-1.5">
                              {a.personer.map(p => (
                                <li key={p.navn} className="rounded-full bg-white px-2.5 py-0.5 text-xs text-gray-800 ring-1 ring-gray-200">
                                  {p.navn} <span className="tabular-nums text-gray-500">{en1.format(p.timer)} t</span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ),
                    ]
                  })}
                </tbody>
              </table>
            </div>
            {produktion.udenJob.produktioner > 0 && (
              <p className="mt-3 text-xs text-amber-800">
                {kr.format(produktion.udenJob.produktioner)} montager ({kr.format(produktion.udenJob.raaKg)} kg råvare,{' '}
                {kr.format(produktion.udenJob.outKg)} kg output) har intet Dan-Time-job og kan ikke lægges på en afdeling.
                Sæt linjen på family-kortet (eller varekortet) i BC, så kommer de med fremover.
              </p>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Ramme titel="Råvare kg pr. mandetime" undertitel="Pr. afdeling pr. dag. Skyggede dage mangler timer i Dan-Time.">
              <Linjer datoer={prDatoer} serier={prRaaPrTime} farve={prFarveAf} format={v => kr.format(v)} lukkede={prUdaekket} />
              <Forklaring navne={prRaaPrTime.map(s => s.navn)} farve={prFarveAf} />
            </Ramme>
            <Ramme titel="Output kg pr. mandetime" undertitel="Samme dage — færdigvare i stedet for råvare.">
              <Linjer datoer={prDatoer} serier={prOutPrTime} farve={prFarveAf} format={v => kr.format(v)} lukkede={prUdaekket} />
              <Forklaring navne={prOutPrTime.map(s => s.navn)} farve={prFarveAf} />
            </Ramme>
          </div>

          <Ramme titel="Råvare kg pr. dag" undertitel="Stablet pr. afdeling, efter den dag montagen blev afsluttet.">
            <StakketSoejler datoer={prDatoer} serier={prRaaSerier} farve={prFarveAf} format={v => `${kr.format(v)} kg`} lukkede={prUdaekket} />
            <Forklaring navne={prAfd.map(a => a.jobNavn)} farve={prFarveAf} />
          </Ramme>
        </>
      )}

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
              undertitel={
                daekning === null
                  ? 'Kun for pakkere der stempler i Dan-Time.'
                  : `Kun for de pakkere der stempler i Dan-Time — de står for ${daekning} % af linjerne. Resten pakkes af folk uden stempling, og deres linjer tælles bevidst ikke med her.`
              }
            >
              <Linjer datoer={pDatoer} serier={prTimeSerie} farve={() => SERIE[2]} format={v => kr.format(v)} />
            </Ramme>
          </div>

          <Ramme
            titel="Linjer pr. arbejdstime — pr. pakker"
            undertitel={
              prTimePrPakker.length === 0
                ? 'Ingen pakkere er koblet til Dan-Time endnu. Koblingen sættes under Skærme → Medarbejdere.'
                : `Personens egne linjer delt med personens egne stemplede timer. Kun ${medTimer.join(', ')} stempler i Dan-Time — de øvrige pakkere har ingen timer at regne på.`
            }
            tom={prTimePrPakker.length === 0 ? 'Mangler kobling mellem pakkerkode og Dan-Time.' : undefined}
          >
            <Linjer datoer={pDatoer} serier={prTimePrPakker} farve={farveAf} format={v => kr.format(v)} />
            <Forklaring navne={medTimer} farve={farveAf} />
          </Ramme>

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
          {prDatoer.length > 0 && (
            <Tabel
              titel="Produktion dag for dag"
              hoveder={['Dato', 'Ugedag', 'Timer i alt', 'Note',
                        ...prAfd.flatMap(a => [`${a.jobNavn} råvare`, `${a.jobNr} output`, `${a.jobNr} timer`, `${a.jobNr} råv./t`, `${a.jobNr} outp./t`])]}
              raekker={produktion.dage.map(d => [
                kortDato(d.dato), ugedagNavn(d.ugedag), en1.format(d.timerIAlt), d.daekket ? '' : 'mangler timer',
                ...prAfd.flatMap(a => {
                  const x = prDagJob(d, a.jobNr)
                  if (!x) return ['—', '—', '—', '—', '—']
                  return [
                    kr.format(x.raaKg), kr.format(x.outKg), en1.format(x.timer),
                    d.daekket && x.timer && a.raaPrTime !== null ? kr.format(x.raaKg / x.timer) : '—',
                    d.daekket && x.timer ? kr.format(x.outKg / x.timer) : '—',
                  ]
                }),
              ])}
            />
          )}
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
          {sDatoer.length > 0 && (
            <Tabel
              titel="Salgslinjer dag for dag"
              hoveder={['Dato', 'Ugedag', 'Linjer', ...salg.saelgere.flatMap(k => [k, `${k} %`])]}
              raekker={salg.dage.map(d => [
                kortDato(d.dato), ugedagNavn(d.ugedag), kr.format(d.linjer),
                ...salg.saelgere.flatMap(k => {
                  const s = d.saelgere.find(x => x.kode === k)
                  return s
                    ? [kr.format(s.linjer), `${Math.round((s.linjer / d.linjer) * 100)} %`]
                    : ['—', '—']
                }),
              ])}
            />
          )}
          {tDatoer.length > 0 && (
            <Tabel
              titel="Telefon dag for dag"
              hoveder={['Dato', 'Ugedag', 'Opkald', 'Ind', 'Ud', 'Ubesvaret', 'Minutter', 'Svartid',
                        ...telefon.personer.flatMap(n => [n, `${n} min`])]}
              raekker={telefon.dage.map(d => [
                kortDato(d.dato), ugedagNavn(d.ugedag),
                kr.format(d.opkald), kr.format(d.ind), kr.format(d.ud), kr.format(d.ubesvarede),
                kr.format(d.minutter),
                d.ventMedian !== null ? `${kr.format(d.ventMedian)} s` : '—',
                ...telefon.personer.flatMap(n => {
                  const p = d.personer.find(x => x.navn === n)
                  return p ? [kr.format(p.opkald), kr.format(p.minutter)] : ['—', '—']
                }),
              ])}
            />
          )}
          {finans && (
            <Tabel
              titel="Omsætning dag for dag"
              hoveder={['Dato', 'Ugedag', 'Omsætning', 'Kilo', 'Fakturaer',
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
