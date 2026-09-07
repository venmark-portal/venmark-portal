'use client'

// Visning af de kode-definerede BC-widgets. Alt er skruet stort op: en skærm
// læses på 3-5 meters afstand, ikke fra en kontorstol.

import type { DagensSalgData, LeveringerIDagData } from '@/lib/signage/widgets'

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
    default:                 return <Frame title="Ukendt widget"><p /></Frame>
  }
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
