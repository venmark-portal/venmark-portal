'use client'

// Fase 1-player: ÉN zone der roterer mellem skærmens slides.
//
// NB: den anden Claude-session ejer skærm-frontenden. Det her er "bevis flowet"-
// playeren — den taler det endelige API (manifest / data / heartbeat), så den kan
// skiftes ud uden at røre serveren.
//
// Tre løkker kører uafhængigt:
//   manifest hvert 15 s  → ny version = redaktøren har ændret noget → hent forfra
//   data     hvert 30 s  → friske BC-tal (serveren har selv en delt cache)
//   heartbeat hvert 30 s → admin kan se om skærmen reelt kører
// Fejler et kald, beholder vi det vi har. Skærmen må aldrig gå sort.

import { useCallback, useEffect, useRef, useState } from 'react'
import WidgetView, { type WidgetPayload } from '@/components/skaerm/WidgetView'

interface Slide {
  widgetId:    string
  params:      Record<string, number>
  durationSec: number
}

export interface PlayerData {
  version:     string
  name:        string
  orientation: 'landscape' | 'portrait'
  slides:      Slide[]
  widgets:     WidgetPayload[]
}

const MANIFEST_MS  = 15_000
const DATA_MS      = 30_000
const HEARTBEAT_MS = 30_000

export default function Player({ token, initial }: { token: string; initial: PlayerData }) {
  const [slides,  setSlides]  = useState<Slide[]>(initial.slides)
  const [widgets, setWidgets] = useState<WidgetPayload[]>(initial.widgets)
  const [idx,     setIdx]     = useState(0)
  const [klokken, setKlokken] = useState<string | null>(null)

  const version = useRef(initial.version)

  const hentData = useCallback(async () => {
    const res = await fetch(`/api/skaerm/${token}/data`, { cache: 'no-store' })
    if (!res.ok) return
    const d = await res.json()
    setWidgets(d.widgets ?? [])
  }, [token])

  // Manifest-poll: skifter versionen, har redaktøren ændret opsætningen.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/skaerm/${token}/manifest`, { cache: 'no-store' })
        if (!res.ok) return
        const m = await res.json()
        if (m.version === version.current) return
        version.current = m.version
        setSlides(m.slides ?? [])
        setIdx(0)
        await hentData()
      } catch { /* netfejl — vi kører videre på det vi har */ }
    }, MANIFEST_MS)
    return () => clearInterval(t)
  }, [token, hentData])

  // Data-poll.
  useEffect(() => {
    const t = setInterval(() => { hentData().catch(() => {}) }, DATA_MS)
    return () => clearInterval(t)
  }, [hentData])

  // Heartbeat.
  useEffect(() => {
    const slaa = () => {
      fetch(`/api/skaerm/${token}/heartbeat`, { method: 'POST', cache: 'no-store' }).catch(() => {})
    }
    slaa()
    const t = setInterval(slaa, HEARTBEAT_MS)
    return () => clearInterval(t)
  }, [token])

  // Rotation mellem slides.
  useEffect(() => {
    if (slides.length < 2) return
    const ms = Math.max(5, slides[idx]?.durationSec ?? 20) * 1000
    const t  = setTimeout(() => setIdx(i => (i + 1) % slides.length), ms)
    return () => clearTimeout(t)
  }, [slides, idx])

  // Ur i hjørnet.
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

  const aktuel = widgets[idx]

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-900">
      {/* Alle slides ligger i DOM'en og skiftes med opacity — intet sort blink. */}
      {slides.map((s, i) => (
        <div
          key={`${s.widgetId}-${i}`}
          className="absolute inset-0 transition-opacity duration-700"
          style={{ opacity: i === idx ? 1 : 0 }}
          aria-hidden={i !== idx}
        >
          <WidgetView payload={widgets[i]} />
        </div>
      ))}

      <div className="absolute bottom-[2vh] right-[3vh] flex items-baseline gap-[2vw] text-[2.4vh] text-slate-500">
        {aktuel?.stale && aktuel.fetchedAt && (
          <span className="text-amber-400">Opdateret kl. {klokkeslet(aktuel.fetchedAt)}</span>
        )}
        <span>{klokken}</span>
      </div>
    </div>
  )
}

function klokkeslet(iso: string): string {
  return new Intl.DateTimeFormat('da-DK', {
    timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}
