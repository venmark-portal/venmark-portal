'use client'

// Visning af de kode-definerede BC-widgets. Alt er skruet stort op: en skærm
// læses på 3-5 meters afstand, ikke fra en kontorstol.

import { useEffect, useRef } from 'react'
import type { DagensSalgData, LeveringerIDagData } from '@/lib/signage/widgets'
import type { ProduktionNu, UdbytteRaekke } from '@/lib/produktion'
import type { AfvistLinje, BeskedFeed, Reklamation, TabtKunde } from '@/lib/kontor'
import type { PakkeriStatus } from '@/lib/pakkeri'

export interface WidgetPayload {
  widgetId:  string
  data:      unknown
  fetchedAt: string | null
  stale:     boolean
  error?:    string
}

const nf = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 })

export default function WidgetView({ payload }: { payload: WidgetPayload | undefined }) {
  if (!payload) return null

  if (payload.data === null) {
    return (
      <Frame title="Ingen data">
        <p className="text-4xl text-slate-400">
          Data kunne ikke hentes fra Business Central.
        </p>
      </Frame>
    )
  }

  switch (payload.widgetId) {
    case 'dagens-salg':      return <DagensSalg data={payload.data as DagensSalgData} />
    case 'leveringer-i-dag': return <LeveringerIDag data={payload.data as LeveringerIDagData} />
    case 'udbytte-montager': return <Udbytter data={payload.data as UdbytteRaekke[]} />
    case 'produktion-nu':    return <ProduktionNuView data={payload.data as ProduktionNu} />
    case 'beskeder':         return <Beskeder data={payload.data as BeskedFeed} />
    case 'afvist-linjer':    return <Afviste data={payload.data as AfvistLinje[]} />
    case 'reklamationer':    return <Reklamationer data={payload.data as Reklamation[]} />
    case 'tabte-kunder':     return <TabteKunder data={payload.data as TabtKunde[]} />
    case 'pakkeri-status':   return <Pakkeri data={payload.data as PakkeriStatus} />
    default:                 return <Frame title="Ukendt widget"><p /></Frame>
  }
}

// ─── Kontorskærm ─────────────────────────────────────────────────────────────

const SLAGS = {
  mail:     { navn: 'Mail',   farve: 'bg-sky-500/20 text-sky-300' },
  sms:      { navn: 'SMS',    farve: 'bg-emerald-500/20 text-emerald-300' },
  portal:   { navn: 'Portal', farve: 'bg-violet-500/20 text-violet-300' },
  webordre: { navn: 'Ordre',  farve: 'bg-amber-500/20 text-amber-300' },
} as const

/** I dag: kun klokkeslæt. Ældre: dato OG klokkeslæt — tiden skal altid med. */
function klokkeslaet(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const kl = new Intl.DateTimeFormat('da-DK', {
    timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit',
  }).format(d)
  const dag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' })
  if (dag.format(d) === dag.format(new Date())) return kl
  const dato = new Intl.DateTimeFormat('da-DK', {
    timeZone: 'Europe/Copenhagen', day: '2-digit', month: '2-digit',
  }).format(d)
  return `${dato} ${kl}`
}

function Beskeder({ data }: { data: BeskedFeed }) {
  return (
    <Frame title="Beskeder">
      <div className="flex h-full flex-col">
        {data.beskeder.length === 0 && <p className="text-[2.5vh] text-slate-400">Ingen beskeder.</p>}
        {data.beskeder.map((b, i) => {
          const s = SLAGS[b.slags]
          return (
            <div key={i} className="flex items-baseline gap-[0.4vw] border-b border-white/10 py-[0.2vh]">
              {/* Webordre med "besked til Venmark" er den ene slags ordre nogen skal
                  reagere på — den får kraftigere farve, så den ikke drukner. */}
              <span className={`shrink-0 rounded px-[0.3vw] text-[1.25vh] font-semibold ${
                b.harBesked ? 'bg-amber-400/40 text-amber-100' : s.farve
              }`}>{s.navn}</span>
              <span className="w-[4.5vw] shrink-0 text-[1.45vh] tabular-nums text-slate-500">{klokkeslaet(b.tid)}</span>
              <span className="w-[7vw] shrink-0 truncate text-[1.55vh] text-slate-300" title={b.fra}>{b.fra}</span>
              <span className={`min-w-0 flex-1 truncate text-[1.55vh] ${b.harBesked ? 'text-amber-100' : 'text-white'}`}>{b.tekst}</span>
            </div>
          )
        })}
        {data.mangler.length > 0 && (
          <p className="mt-auto pt-[0.5vh] text-[1.8vh] text-amber-400">
            Kunne ikke hentes: {data.mangler.join(', ')}
          </p>
        )}
      </div>
    </Frame>
  )
}

function Afviste({ data }: { data: AfvistLinje[] }) {
  return (
    <Frame title="Afviste varer">
      {data.length === 0 && <p className="text-[2.2vh] text-slate-400">Ingen afviste linjer.</p>}
      {data.map((r, i) => (
        <div key={i} className="flex items-baseline gap-[0.4vw] border-b border-white/10 py-[0.3vh]">
          <span className="w-[4.5vw] shrink-0 truncate text-[1.7vh] text-amber-300">{r.saelger}</span>
          <span className="shrink-0 font-mono text-[1.6vh] text-slate-500">{r.vareNr}</span>
          <span className="min-w-0 flex-1 truncate text-[1.8vh] text-white" title={r.kunde}>{r.vare}</span>
          <span className="shrink-0 font-mono text-[1.6vh] text-slate-500">{r.ordre}</span>
          <span className="shrink-0 text-[1.8vh] font-semibold tabular-nums text-rose-400">−{nf1.format(r.oversolgt)}</span>
        </div>
      ))}
    </Frame>
  )
}

function Reklamationer({ data }: { data: Reklamation[] }) {
  return (
    <Frame title="Reklamationer">
      {data.length === 0 && <p className="text-[2.2vh] text-slate-400">Ingen.</p>}
      {data.map((r, i) => (
        <div key={i} className="border-b border-white/10 py-[0.4vh]">
          <div className="truncate text-[2.1vh] text-white">{r.emne}</div>
          <div className="truncate text-[1.8vh] text-slate-400">{r.kunde} · {klokkeslaet(r.tid)}</div>
        </div>
      ))}
    </Frame>
  )
}

function TabteKunder({ data }: { data: TabtKunde[] }) {
  return (
    <Frame title={`Ikke købt i 7–21 dage${data.length ? ` (${data.length})` : ''}`}>
      {data.length === 0
        ? <p className="text-[2.2vh] text-slate-400">Ingen — alle har handlet.</p>
        : (
          <Rullende>
            {data.map(k => (
              <div key={k.kundeNr} className="flex items-baseline gap-[0.5vw] border-b border-white/10 py-[0.35vh]">
                <span className="min-w-0 flex-1 truncate text-[2vh] text-white" title={k.kundeNr}>{k.navn}</span>
                <span className={`shrink-0 text-[2vh] font-semibold tabular-nums ${k.dage >= 14 ? 'text-rose-400' : 'text-amber-300'}`}>
                  {k.dage} dg
                </span>
              </div>
            ))}
          </Rullende>
        )}
    </Frame>
  )
}

/**
 * Ruller langsomt gennem indholdet når det er højere end pladsen, holder pause i
 * hver ende og starter forfra. Passer ikke listen, står den bare stille — så
 * bevæger skærmen sig kun når der faktisk er noget at se.
 */
function Rullende({ children }: { children: React.ReactNode }) {
  const ydre = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ydre.current
    if (!el) return
    let stoppet = false
    let retning = 1
    let pause = 25          // ticks — lille ophold før den sætter i gang

    const t = setInterval(() => {
      if (stoppet) return
      const plads = el.scrollHeight - el.clientHeight
      if (plads <= 4) return                       // alt kan ses; lad være at rulle
      if (pause > 0) { pause--; return }
      el.scrollTop += retning
      if (el.scrollTop >= plads - 1 || el.scrollTop <= 0) { retning *= -1; pause = 60 }
    }, 50)

    return () => { stoppet = true; clearInterval(t) }
  }, [children])

  return <div ref={ydre} className="h-full overflow-hidden">{children}</div>
}

const nf1 = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 })

function Udbytter({ data }: { data: UdbytteRaekke[] }) {
  if (!data?.length) {
    return <Frame title="Udbytter"><p className="text-[3.5vh] text-slate-400">Ingen bogførte montager at vise endnu.</p></Frame>
  }
  const farve = (p: number) => p >= 60 ? "text-emerald-400" : p >= 35 ? "text-amber-300" : "text-rose-400"

  return (
    <Frame title="Udbytter · senest lukkede montager">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-white/25 text-[1.8vh] uppercase tracking-wide text-slate-400">
            <th className="py-[0.5vh] text-left font-medium">Montage</th>
            <th className="py-[0.5vh] text-left font-medium">Vare</th>
            <th className="py-[0.5vh] text-left font-medium">Hovedvare</th>
            <th className="py-[0.5vh] text-right font-medium">Råvare</th>
            <th className="py-[0.5vh] text-right font-medium">Hoved</th>
            <th className="py-[0.5vh] text-right font-medium">Biprod.</th>
            <th className="py-[0.5vh] text-right font-medium">I alt</th>
            <th className="py-[0.5vh] text-right font-medium">Tid</th>
            <th className="py-[0.5vh] text-left font-medium">Hvem</th>
          </tr>
        </thead>
        <tbody>
          {data.map(r => (
            <tr key={r.productionNo} className="border-b border-white/10">
              <td className="py-[0.6vh] pr-[0.6vw] text-[1.9vh] text-slate-400">
                {dansk(r.postingDate)}{r.tid && <span className="ml-[0.3vw] text-slate-300">{r.tid}</span>}
                <span className="ml-[0.4vw] text-slate-500">{r.productionNo}</span>
              </td>
              <td className="py-[0.6vh] pr-[0.6vw] font-mono text-[1.9vh] text-slate-400">{r.itemNo}</td>
              <td className="max-w-0 truncate py-[0.6vh] pr-[0.6vw] text-[2.2vh] text-white"
                  title={r.hovedGaettet ? r.hovedNavn + " (ikke markeret som hovedvare — største er valgt)" : r.hovedNavn}>
                {r.hovedNavn}{r.hovedGaettet && <span className="text-slate-500"> *</span>}
              </td>
              <td className="py-[0.7vh] text-right text-[2.2vh] tabular-nums text-slate-400">{nf.format(r.rawQty)} kg</td>
              <td className={`py-[0.7vh] pl-[0.8vw] text-right text-[2.8vh] font-bold tabular-nums ${farve(r.hovedPct)}`}>
                {nf1.format(r.hovedPct)}%
              </td>
              <td className="py-[0.7vh] pl-[0.8vw] text-right text-[2.5vh] tabular-nums text-slate-300">
                {r.biproduktPct > 0 ? nf1.format(r.biproduktPct) + "%" : "–"}
              </td>
              <td className="py-[0.7vh] pl-[0.8vw] text-right text-[2.8vh] font-semibold tabular-nums text-sky-300">
                {nf1.format(r.ialtPct)}%
              </td>
              <td className="py-[0.6vh] pl-[0.8vw] text-right text-[1.9vh] tabular-nums text-slate-300"
                  title="Forbrugte mandetimer — summen over medarbejderne på linjen">
                {r.minutter > 0 ? timerMin(r.minutter) : <span className="text-slate-600">–</span>}
              </td>
              <td className="py-[0.6vh] pl-[0.8vw] text-[1.9vh] text-emerald-300/90">
                {r.initialer.join(' ') || <span className="text-slate-600">–</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.some(r => r.hovedGaettet) && (
        <p className="mt-[1vh] text-[1.9vh] text-slate-500">* ingen vare er markeret som hovedvare — den største er vist</p>
      )}
    </Frame>
  )
}

function ProduktionNuView({ data }: { data: ProduktionNu }) {
  return (
    <Frame title="Produktion nu">
      <div className="flex h-full flex-col gap-[1.2vh]">
        {data.linjer.length === 0 && (
          <p className="text-[3vh] text-slate-400">Ingen produktioner er startet.</p>
        )}

        {data.linjer.map(l => (
          <div key={l.jobNo} className="border-b border-white/10 pb-[0.8vh]">
            <div className="flex items-baseline justify-between gap-[1vw]">
              <span className="truncate text-[2.9vh] font-bold uppercase tracking-wide text-sky-300">
                {l.jobNavn}
              </span>
              <span className="flex shrink-0 flex-wrap justify-end gap-[0.4vw]">
                {l.folk.length > 0
                  ? l.folk.map(f => <Init key={f.lonnr} f={f} />)
                  : <span className="text-[2.2vh] text-slate-500">ingen stemplet ind</span>}
              </span>
            </div>

            {l.produktioner.map(p => (
              <div key={p.no} className="flex items-baseline gap-[0.6vw] pl-[1vw]">
                {p.afsluttet && (
                  <span className="shrink-0 font-mono text-[2.1vh] text-slate-500">
                    {p.afsluttetKl}{p.itemNo && ` ${p.itemNo}`}
                  </span>
                )}
                <span className={`truncate text-[2.4vh] ${p.afsluttet ? 'text-slate-500 line-through' : 'text-white'}`}>
                  {p.description || p.no}
                </span>
                {p.afsluttet && (
                  <span className="flex shrink-0 gap-[0.3vw]">
                    {p.folk.map(f => <Init key={f.lonnr} f={f} dæmpet />)}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}

        {data.udenLinje.length > 0 && (
          <p className="text-[2.1vh] text-amber-400">
            {data.udenLinje.length} produktion{data.udenLinje.length === 1 ? "" : "er"} uden linje —
            sæt Dan-Time jobnr. på familien
          </p>
        )}
      </div>
    </Frame>
  )
}

/** Initialer med det fulde navn som tooltip — nogle ser skærmen på en PC. */
function Init({ f, dæmpet }: { f: { navn: string; initialer: string }; dæmpet?: boolean }) {
  return (
    <span title={f.navn}
          className={`rounded px-[0.5vw] text-[2.2vh] font-semibold ${
            dæmpet ? "bg-white/5 text-slate-400" : "bg-emerald-500/15 text-emerald-300"}`}>
      {f.initialer}
    </span>
  )
}

/** 138 → "2:18" — mandetimer:minutter. */
function timerMin(minutter: number): string {
  const t = Math.floor(minutter / 60)
  const m = Math.round(minutter % 60)
  return `${t}:${String(m).padStart(2, '0')}`
}

function dansk(iso: string): string {
  const [a, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : iso
}

// ─── Pakkeriskærm ────────────────────────────────────────────────────────────

function Noegletal({ vaerdi, tekst, farve = 'text-white' }: { vaerdi: number; tekst: string; farve?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg bg-white/5 py-[1.4vh]">
      <span className={`text-[7vh] font-bold leading-none tabular-nums ${farve}`}>{nf.format(vaerdi)}</span>
      <span className="mt-[0.6vh] text-center text-[1.9vh] uppercase tracking-wide text-slate-400">{tekst}</span>
    </div>
  )
}

function Pakkeri({ data }: { data: PakkeriStatus }) {
  // Pakkerne skal kunne stå på én side uden at rulle — skriftstørrelsen falder
  // med antallet, så 3 pakkere fylder skærmen og 10 stadig kan være der.
  const n     = data.pakkere.length
  const raekke = n <= 4 ? '5vh' : n <= 7 ? '3.6vh' : n <= 10 ? '2.8vh' : '2.2vh'

  return (
    <Frame title="Pakkeri i dag">
      <div className="flex h-full flex-col gap-[1.6vh]">

        <div className="flex shrink-0 gap-[1vw]">
          <Noegletal vaerdi={data.ordrerIAlt} tekst="Ordrer i alt" />
          <Noegletal
            vaerdi={data.ordrerUdenPakker}
            tekst="Ordrer uden pakker"
            farve={data.ordrerUdenPakker > 0 ? 'text-amber-300' : 'text-emerald-400'}
          />
          <Noegletal
            vaerdi={data.aabneLinjer}
            tekst="Åbne linjer"
            farve={data.aabneLinjer > 0 ? 'text-amber-300' : 'text-emerald-400'}
          />
          <Noegletal vaerdi={data.linjerIAlt} tekst="Linjer i alt" />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {n === 0
            ? <p className="text-[2.5vh] text-slate-400">Ingen linjer er pakket endnu i dag.</p>
            : (
              <>
                <div className="flex items-baseline gap-[1vw] border-b border-white/20 pb-[0.4vh] text-[1.9vh] uppercase tracking-wide text-slate-400">
                  <span className="min-w-0 flex-1">Pakker</span>
                  <span className="w-[10vw] shrink-0 text-right">Linjer pakket</span>
                  <span className="w-[10vw] shrink-0 text-right">Heraf scannet</span>
                </div>
                {data.pakkere.map(p => {
                  // En linje uden scanning er sat pakket i hånden. Det er ikke
                  // forbudt, men det er det man skal kunne se herfra.
                  const mangler = p.linjer - p.scannet
                  return (
                    <div key={p.pakker} className="flex items-baseline gap-[1vw] border-b border-white/10 py-[0.5vh]" style={{ fontSize: raekke }}>
                      <span className="min-w-0 flex-1 truncate font-medium text-white">{p.pakker}</span>
                      <span className="w-[10vw] shrink-0 text-right font-semibold tabular-nums text-white">{nf.format(p.linjer)}</span>
                      <span className={`w-[10vw] shrink-0 text-right font-semibold tabular-nums ${mangler > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>
                        {nf.format(p.scannet)}
                      </span>
                    </div>
                  )
                })}
              </>
            )}
        </div>
      </div>
    </Frame>
  )
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  // Målene er i vh, så de holder på et TV. Titel og luft er skruet ned, fordi
  // widgets nu også sidder i en kvart skærm på dashboard-layoutet.
  return (
    <div className="flex h-full w-full flex-col gap-[1.2vh] overflow-hidden p-[2.2vh]">
      <h1 className="shrink-0 text-[3vh] font-bold uppercase tracking-wide text-sky-400">{title}</h1>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}

function DagensSalg({ data }: { data: DagensSalgData }) {
  return (
    <Frame title="Dagens salg">
      <table className="w-full border-collapse">
        <tbody>
          {data.raekker.map(r => (
            <tr key={`${r.itemNo}|${r.uom}`} className="border-b border-white/10">
              <td className="py-[1.2vh] pr-[2vw] text-[4.5vh] font-medium text-white">
                {r.description || r.itemNo}
              </td>
              <td className="py-[1.2vh] text-right text-[5.5vh] font-bold tabular-nums text-emerald-400">
                {nf.format(r.salg)}
              </td>
              <td className="w-[10vw] py-[1.2vh] pl-[1vw] text-[3.5vh] text-slate-400">{r.uom}</td>
            </tr>
          ))}
          {data.raekker.length === 0 && (
            <tr><td className="py-[2vh] text-[4vh] text-slate-400">Intet salg registreret endnu i dag</td></tr>
          )}
        </tbody>
      </table>
    </Frame>
  )
}

function LeveringerIDag({ data }: { data: LeveringerIDagData }) {
  return (
    <Frame title="Leveringer i dag">
      <div className="flex h-full flex-col gap-[3vh]">
        <div className="flex gap-[4vw]">
          <Tal label="Ordrer" vaerdi={nf.format(data.antalOrdrer)} />
          <Tal label="Kilo"   vaerdi={nf.format(data.totalKg)} />
        </div>
        <div className="flex flex-col gap-[1vh]">
          {data.koder.map(k => (
            <div key={k.code} className="flex items-baseline justify-between border-b border-white/10 pb-[0.8vh]">
              <span className="text-[4vh] text-white">{k.code}</span>
              <span className="text-[4vh] tabular-nums text-slate-300">
                {nf.format(k.antal)} ordrer · {nf.format(k.kg)} kg
              </span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  )
}

function Tal({ label, vaerdi }: { label: string; vaerdi: string }) {
  return (
    <div>
      <div className="text-[3vh] uppercase tracking-widest text-slate-400">{label}</div>
      <div className="text-[12vh] font-bold leading-none tabular-nums text-white">{vaerdi}</div>
    </div>
  )
}
