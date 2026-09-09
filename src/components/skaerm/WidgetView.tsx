'use client'

// Visning af de kode-definerede BC-widgets. Alt er skruet stort op: en skærm
// læses på 3-5 meters afstand, ikke fra en kontorstol.

import type { DagensSalgData, LeveringerIDagData } from '@/lib/signage/widgets'
import type { ProduktionNu, UdbytteRaekke } from '@/lib/produktion'

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
    default:                 return <Frame title="Ukendt widget"><p /></Frame>
  }
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
          <tr className="border-b border-white/25 text-[2vh] uppercase tracking-wide text-slate-400">
            <th className="py-[0.6vh] text-left font-medium">Montage</th>
            <th className="py-[0.6vh] text-left font-medium">Hovedvare</th>
            <th className="py-[0.6vh] text-right font-medium">Råvare</th>
            <th className="py-[0.6vh] text-right font-medium">Hoved</th>
            <th className="py-[0.6vh] text-right font-medium">Biprod.</th>
            <th className="py-[0.6vh] text-right font-medium">I alt</th>
          </tr>
        </thead>
        <tbody>
          {data.map(r => (
            <tr key={r.productionNo} className="border-b border-white/10">
              <td className="py-[0.7vh] pr-[0.8vw] text-[2.2vh] text-slate-400">
                {dansk(r.postingDate)}<span className="ml-[0.5vw] text-slate-500">{r.productionNo}</span>
              </td>
              <td className="max-w-0 truncate py-[0.7vh] pr-[0.8vw] text-[2.5vh] text-white"
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

function dansk(iso: string): string {
  const [a, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : iso
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
