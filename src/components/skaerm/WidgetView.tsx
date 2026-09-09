'use client'

// Visning af de kode-definerede BC-widgets. Alt er skruet stort op: en skærm
// læses på 3-5 meters afstand, ikke fra en kontorstol.

import type { DagensSalgData, LeveringerIDagData } from '@/lib/signage/widgets'
import type { ProduktionNu, UdbytteMontage } from '@/lib/produktion'

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
    case 'udbytte-montager': return <Udbytter data={payload.data as UdbytteMontage[]} />
    case 'produktion-nu':    return <ProduktionNuView data={payload.data as ProduktionNu} />
    default:                 return <Frame title="Ukendt widget"><p /></Frame>
  }
}

const nf1 = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 })

function Udbytter({ data }: { data: UdbytteMontage[] }) {
  if (!data?.length) {
    return <Frame title="Udbytter"><p className="text-[4vh] text-slate-400">Ingen bogførte montager at vise endnu.</p></Frame>
  }
  return (
    <Frame title="Udbytter · senest lukkede montager">
      <div className="grid grid-cols-2 gap-x-[3vw] gap-y-[1.2vh]">
        {data.map(m => (
          <div key={m.productionNo} className="border-b border-white/10 pb-[0.8vh]">
            <div className="flex items-baseline justify-between text-[2.6vh] text-slate-400">
              <span>{m.productionNo} · {dansk(m.postingDate)}</span>
              <span>{nf1.format(m.rawQty)} kg råvare</span>
            </div>
            {m.produkter.slice(0, 3).map(p => (
              <div key={p.itemNo} className="flex items-baseline justify-between gap-[1vw]">
                <span className="truncate text-[3vh] text-white">{p.description || p.itemNo}</span>
                <span className={`shrink-0 text-[3.6vh] font-bold tabular-nums ${p.yieldPct >= 60 ? 'text-emerald-400' : p.yieldPct >= 35 ? 'text-amber-300' : 'text-rose-400'}`}>
                  {nf1.format(p.yieldPct)}%
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Frame>
  )
}

function ProduktionNuView({ data }: { data: ProduktionNu }) {
  return (
    <Frame title="Produktion nu">
      <div className="flex h-full gap-[3vw]">
        <div className="flex-1">
          {data.produktioner.length === 0 && (
            <p className="text-[3.5vh] text-slate-400">Ingen produktioner er startet.</p>
          )}
          {data.produktioner.slice(0, 7).map(p => (
            <div key={p.no} className="border-b border-white/10 py-[0.9vh]">
              <div className="flex items-baseline justify-between gap-[1vw]">
                <span className="truncate text-[3.2vh] text-white">{p.description || p.no}</span>
                <span className="shrink-0 text-[2.6vh] text-slate-400">
                  {p.jobNavn ?? (p.jobNo ? `job ${p.jobNo}` : '— mangler linje')}
                </span>
              </div>
              <div className="flex flex-wrap gap-[0.5vw] text-[2.8vh]">
                {p.folk.length > 0
                  ? p.folk.map(f => (
                      <span key={f.lonnr} title={f.navn}
                            className="rounded bg-emerald-500/15 px-[0.7vw] font-semibold text-emerald-300">
                        {f.initialer}
                      </span>
                    ))
                  : <span className="text-slate-500">ingen stemplet ind</span>}
              </div>
            </div>
          ))}
          {data.udenJob > 0 && (
            <p className="mt-[1vh] text-[2.4vh] text-amber-400">
              {data.udenJob} produktion{data.udenJob === 1 ? '' : 'er'} mangler linje — sæt Dan-Time jobnr. på familien
            </p>
          )}
        </div>

        <div className="w-[30%] shrink-0 border-l border-white/15 pl-[2vw]">
          <div className="text-[2.6vh] uppercase tracking-widest text-slate-400">Timer i dag</div>
          {data.linjer.map(l => (
            <div key={l.jobNo} className="mt-[1vh] flex items-baseline justify-between">
              <span className="truncate text-[2.8vh] text-white">{l.jobNavn ?? `job ${l.jobNo}`}</span>
              <span className="shrink-0 text-[2.8vh] tabular-nums text-slate-300">
                {nf1.format(l.timer)} t
                {l.loenKr !== null && <span className="text-slate-500"> · {nf.format(l.loenKr)} kr</span>}
              </span>
            </div>
          ))}
          {data.timepris === 0 && (
            <p className="mt-[1.5vh] text-[2.2vh] text-amber-400">
              Gns. timeløn mangler i Virksomhedsoplysninger
            </p>
          )}
        </div>
      </div>
    </Frame>
  )
}

function dansk(iso: string): string {
  const [a, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : iso
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col gap-[2vh] p-[4vh]">
      <h1 className="text-[5vh] font-bold uppercase tracking-wide text-sky-400">{title}</h1>
      <div className="flex-1">{children}</div>
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
