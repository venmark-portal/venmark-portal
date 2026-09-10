'use client'

// Playeren. To zoner: BC-tallene står fast øverst, slide-båndet roterer i bunden
// (layout 'split'). Med layout 'single' roterer alt i én fuldskærms-zone.
//
// Tre løkker kører uafhængigt:
//   manifest hvert 15 s  → ny version = ændret opsætning ELLER et tidsplanlagt
//                          slide der er gået ind/ud → hent hele tilstanden forfra
//   data     hvert 30 s  → friske BC-tal (serveren har selv en delt cache)
//   heartbeat hvert 30 s → admin kan se om skærmen reelt kører
// Fejler et kald, beholder vi det vi har. Skærmen må aldrig gå sort.

import { useCallback, useEffect, useRef, useState } from 'react'
import WidgetView, { type WidgetPayload } from '@/components/skaerm/WidgetView'

interface Slide {
  widgetId:    string
  durationSec: number
  zone:        string
}

export interface PlayerData {
  version:     string
  name:        string
  orientation: 'landscape' | 'portrait'
  layout:      'single' | 'split' | 'dashboard' | 'kontor'
  slides:      Slide[]
  widgets:     WidgetPayload[]
}

const MANIFEST_MS  = 15_000
const DATA_MS      = 30_000
const HEARTBEAT_MS = 30_000

export default function Player({ token, initial }: { token: string; initial: PlayerData }) {
  const [state, setState]     = useState<PlayerData>(initial)
  const [klokken, setKlokken] = useState<string | null>(null)
  const version  = useRef(initial.version)
  const serverId = useRef<string | null>(null)
  const startet  = useRef(Date.now())

  const hentAlt = useCallback(async () => {
    const res = await fetch(`/api/skaerm/${token}/data`, { cache: 'no-store' })
    if (!res.ok) return
    const d: PlayerData = await res.json()
    version.current = d.version
    setState(d)
  }, [token])

  // Manifest-poll: skifter versionen, er der sket noget — enten har redaktøren
  // ændret opsætningen, eller et tidsplanlagt slide er gået ind eller ud.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/skaerm/${token}/manifest`, { cache: 'no-store' })
        if (!res.ok) return
        const m = await res.json()

        // Nyt serverId = der er deployet. Skærmen kører stadig den gamle
        // JavaScript-kode, fordi den aldrig navigerer — så hent siden forfra.
        // Grænsen på et minut er en spærre mod en genindlæsnings-løkke, hvis
        // serveren mod forventning svarer med skiftende id.
        if (serverId.current === null) {
          serverId.current = m.serverId ?? null
        } else if (m.serverId && m.serverId !== serverId.current &&
                   Date.now() - startet.current > 60_000) {
          location.reload()
          return
        }

        if (m.version !== version.current) await hentAlt()
      } catch { /* netfejl — vi kører videre på det vi har */ }
    }, MANIFEST_MS)
    return () => clearInterval(t)
  }, [token, hentAlt])

  useEffect(() => {
    const t = setInterval(() => { hentAlt().catch(() => {}) }, DATA_MS)
    return () => clearInterval(t)
  }, [hentAlt])

  // Browsere struber timere kraftigt i en baggrundsfane, så en skærm der har
  // ligget bagved kan vise gamle tal i minutter. Hent forfra så snart den er
  // synlig igen.
  useEffect(() => {
    const vaagn = () => { if (!document.hidden) hentAlt().catch(() => {}) }
    document.addEventListener('visibilitychange', vaagn)
    return () => document.removeEventListener('visibilitychange', vaagn)
  }, [hentAlt])

  useEffect(() => {
    const slaa = () => {
      fetch(`/api/skaerm/${token}/heartbeat`, { method: 'POST', cache: 'no-store' }).catch(() => {})
    }
    slaa()
    const t = setInterval(slaa, HEARTBEAT_MS)
    return () => clearInterval(t)
  }, [token])

  useEffect(() => {
    const vis = () => setKlokken(
      new Intl.DateTimeFormat('da-DK', {
        timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit',
      }).format(new Date())
    )
    vis()
    const t = setInterval(vis, 10_000)
    return () => clearInterval(t)
  }, [])

  // Indeksér slides med deres payload, så de to aldrig kan komme ud af trit.
  const alle = state.slides.map((s, i) => ({ slide: s, payload: state.widgets[i] }))
  const iZone = (navn: string) => alle.filter(x => x.slide.zone === navn)

  // Dashboard: venstre halvdel + to kvadranter til højre. Faste felter, ikke
  // rotation — tallene skal kunne læses uden at vente på et skift.
  if (state.layout === 'dashboard') {
    return (
      <div className="relative flex h-screen w-screen overflow-hidden bg-slate-900">
        <Zone items={iZone('venstre')} className="min-h-0 w-1/2 shrink-0 border-r border-white/15" />
        <div className="flex min-w-0 flex-1 flex-col">
          <Zone items={iZone('hoejre-top')}  className="min-h-0 flex-1" />
          <Zone items={iZone('hoejre-bund')} className="min-h-0 flex-1 border-t border-white/15" />
        </div>
        <Ur klokken={klokken} items={alle} />
      </div>
    )
  }

  // Kontor: 4x3-gitter i tolvtedele. Beskeder er det vigtigste og ligger øverst
  // til venstre; de tre frie celler venter på mere indhold.
  if (state.layout === 'kontor') {
    return (
      <div className="relative grid h-screen w-screen grid-rows-3 overflow-hidden bg-slate-900
                      [&>*]:border-white/15"
           style={{
             // Beskeder er det vigtigste og går 20 % ind over højre side (Claus).
             gridTemplateColumns: '70% 30%',
             gridTemplateAreas: `"beskeder kunder" "beskeder afvist" "fri reklamationer"`,
           }}>
        <Zone items={iZone('beskeder')}      className="min-h-0 border-b border-r" style={{ gridArea: 'beskeder' }} />
        <Zone items={iZone('kunder')}        className="min-h-0 border-b"          style={{ gridArea: 'kunder' }} />
        <Zone items={iZone('afvist')}        className="min-h-0 border-b"          style={{ gridArea: 'afvist' }} />
        <Zone items={iZone('fri')}           className="min-h-0 border-r"          style={{ gridArea: 'fri' }} />
        <Zone items={iZone('reklamationer')} className="min-h-0"                    style={{ gridArea: 'reklamationer' }} />
        <Ur klokken={klokken} items={alle} />
      </div>
    )
  }

  const split  = state.layout === 'split'
  const main   = split ? alle.filter(x => x.slide.zone !== 'ticker') : alle
  const ticker = split ? iZone('ticker') : []

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-slate-900">
      <Zone items={main} className="min-h-0 flex-1" />

      {ticker.length > 0 && (
        <Zone
          items={ticker}
          className="h-[22vh] min-h-0 shrink-0 border-t border-white/15 bg-slate-950"
        />
      )}

      <Ur klokken={klokken} items={alle} />
    </div>
  )
}

/** Én zone der roterer mellem sine egne slides. */
function Zone({
  items, className, style,
}: {
  items: { slide: Slide; payload: WidgetPayload | undefined }[]
  className?: string
  style?: React.CSSProperties
}) {
  const [idx, setIdx] = useState(0)

  // Falder antallet af slides (fx et tidsplanlagt slide der går ud), må indekset
  // ikke blive stående uden for listen.
  useEffect(() => {
    if (idx >= items.length && items.length > 0) setIdx(0)
  }, [items.length, idx])

  useEffect(() => {
    if (items.length < 2) return
    const ms = Math.max(5, items[idx]?.slide.durationSec ?? 20) * 1000
    const t  = setTimeout(() => setIdx(i => (i + 1) % items.length), ms)
    return () => clearTimeout(t)
  }, [items, idx])

  if (items.length === 0) return null
  const vist = idx < items.length ? idx : 0

  return (
    <div className={`relative ${className ?? ''}`} style={style}>
      {/* Alle slides ligger i DOM'en og skiftes med opacity — intet sort blink. */}
      {items.map((x, i) => (
        <div
          key={`${x.slide.widgetId}-${i}`}
          className="absolute inset-0 transition-opacity duration-700"
          style={{ opacity: i === vist ? 1 : 0 }}
          aria-hidden={i !== vist}
        >
          <WidgetView payload={x.payload} />
        </div>
      ))}
    </div>
  )
}

function Ur({
  klokken, items,
}: {
  klokken: string | null
  items: { payload: WidgetPayload | undefined }[]
}) {
  // Vis "opdateret kl." så snart NOGET på skærmen kører på gamle tal.
  const gammel = items.find(x => x.payload?.stale && x.payload.fetchedAt)?.payload
  return (
    <div className="pointer-events-none absolute bottom-[1.5vh] right-[2.5vh] flex items-baseline gap-[2vw] text-[2.2vh] text-slate-500">
      {gammel?.fetchedAt && (
        <span className="text-amber-400">Opdateret kl. {klokkeslet(gammel.fetchedAt)}</span>
      )}
      <span>{klokken}</span>
    </div>
  )
}

function klokkeslet(iso: string): string {
  return new Intl.DateTimeFormat('da-DK', {
    timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}
