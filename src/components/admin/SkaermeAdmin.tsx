'use client'

// Admin for info-skærme (fase 1): opret skærme, se om de kører, og sæt hvilke
// BC-widgets de viser. Widget-kataloget kommer fra serveren — man kan vælge
// mellem widgets og sætte deres parametre, men aldrig ændre forespørgslen.

import { useEffect, useState } from 'react'

interface ParamDef { key: string; label: string; type: string; default: number; min: number; max: number }
interface WidgetDef { id: string; name: string; description: string; ttlSec: number; params: ParamDef[] }
interface Slide { widgetId: string; params: Record<string, number>; durationSec: number }
interface Screen {
  id: string; name: string; token: string
  orientation: 'landscape' | 'portrait'
  slides: Slide[]; active: boolean
  lastHeartbeat: string | null
}

const HEARTBEAT_GRAENSE_MS = 2 * 60 * 1000

export default function SkaermeAdmin({ baseUrl }: { baseUrl: string }) {
  const [screens, setScreens] = useState<Screen[]>([])
  const [katalog, setKatalog] = useState<WidgetDef[]>([])
  const [henter, setHenter]   = useState(true)
  const [nytNavn, setNytNavn] = useState('')
  const [nyRetning, setNyRetning] = useState<'landscape' | 'portrait'>('landscape')

  async function hent() {
    const res = await fetch('/api/admin/skaerme', { cache: 'no-store' })
    if (res.ok) {
      const d = await res.json()
      setScreens(d.screens ?? [])
      setKatalog(d.katalog ?? [])
    }
    setHenter(false)
  }

  useEffect(() => { hent() }, [])

  async function opret() {
    if (!nytNavn.trim()) return
    await fetch('/api/admin/skaerme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nytNavn.trim(), orientation: nyRetning }),
    })
    setNytNavn('')
    hent()
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/admin/skaerme/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    hent()
  }

  async function slet(s: Screen) {
    if (!confirm(`Slet skærmen "${s.name}"? URL'en holder op med at virke.`)) return
    await fetch(`/api/admin/skaerme/${s.id}`, { method: 'DELETE' })
    hent()
  }

  if (henter) return <p className="text-sm text-gray-500">Henter skærme …</p>

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Opret skærm</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs font-medium text-gray-500">
            Navn
            <input
              value={nytNavn}
              onChange={e => setNytNavn(e.target.value)}
              placeholder="fx Lager 1"
              className="mt-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col text-xs font-medium text-gray-500">
            Retning
            <select
              value={nyRetning}
              onChange={e => setNyRetning(e.target.value as 'landscape' | 'portrait')}
              className="mt-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="landscape">Landskab</option>
              <option value="portrait">Portræt</option>
            </select>
          </label>
          <button
            onClick={opret}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Opret
          </button>
        </div>
      </div>

      {screens.length === 0 && (
        <p className="text-sm text-gray-500">Ingen skærme oprettet endnu.</p>
      )}

      {screens.map(s => (
        <SkaermKort
          key={s.id}
          screen={s}
          katalog={katalog}
          baseUrl={baseUrl}
          onPatch={patch}
          onSlet={slet}
        />
      ))}
    </div>
  )
}

function SkaermKort({
  screen, katalog, baseUrl, onPatch, onSlet,
}: {
  screen: Screen
  katalog: WidgetDef[]
  baseUrl: string
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>
  onSlet: (s: Screen) => Promise<void>
}) {
  const [slides, setSlides] = useState<Slide[]>(screen.slides)
  const [gemt, setGemt] = useState(false)

  const url    = `${baseUrl}/skaerm/${screen.token}`
  const online = screen.lastHeartbeat
    ? Date.now() - new Date(screen.lastHeartbeat).getTime() < HEARTBEAT_GRAENSE_MS
    : false

  async function gem() {
    await onPatch(screen.id, { slides })
    setGemt(true)
    setTimeout(() => setGemt(false), 2000)
  }

  function tilfoej(widgetId: string) {
    const w = katalog.find(k => k.id === widgetId)
    if (!w) return
    setSlides([...slides, {
      widgetId,
      params: Object.fromEntries(w.params.map(p => [p.key, p.default])),
      durationSec: 20,
    }])
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`h-3 w-3 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-400'}`}
            title={screen.lastHeartbeat ? `Sidste livstegn: ${new Date(screen.lastHeartbeat).toLocaleString('da-DK')}` : 'Aldrig set'}
          />
          <div>
            <h2 className="font-semibold text-gray-900">{screen.name}</h2>
            <p className="text-xs text-gray-500">
              {screen.orientation === 'portrait' ? 'Portræt' : 'Landskab'} ·{' '}
              {screen.lastHeartbeat
                ? `sidste livstegn ${new Date(screen.lastHeartbeat).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}`
                : 'ingen livstegn endnu'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a href={url} target="_blank" rel="noreferrer"
             className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">
            Åbn
          </a>
          <button
            onClick={() => navigator.clipboard?.writeText(url)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
          >
            Kopiér URL
          </button>
          <button
            onClick={() => onPatch(screen.id, { active: !screen.active })}
            className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
          >
            {screen.active ? 'Deaktivér' : 'Aktivér'}
          </button>
          <button
            onClick={() => {
              if (confirm('Nyt token? Den gamle URL holder øjeblikkeligt op med at virke, og skærmen skal have den nye.')) {
                onPatch(screen.id, { rotateToken: true })
              }
            }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
          >
            Nyt token
          </button>
          <button
            onClick={() => onSlet(screen)}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-red-600 hover:bg-red-50"
          >
            Slet
          </button>
        </div>
      </div>

      <p className="mt-3 break-all rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600">{url}</p>
      {!screen.active && (
        <p className="mt-2 text-xs font-medium text-red-600">Deaktiveret — URL'en svarer 404.</p>
      )}

      <div className="mt-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Indhold</h3>
        {slides.map((sl, i) => {
          const w = katalog.find(k => k.id === sl.widgetId)
          return (
            <div key={i} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 p-3">
              <div className="min-w-[14rem] flex-1">
                <div className="text-sm font-medium text-gray-900">{w?.name ?? sl.widgetId}</div>
                <div className="text-xs text-gray-500">{w?.description}</div>
              </div>

              {w?.params.map(p => (
                <label key={p.key} className="flex flex-col text-xs font-medium text-gray-500">
                  {p.label}
                  <input
                    type="number" min={p.min} max={p.max}
                    value={sl.params[p.key] ?? p.default}
                    onChange={e => {
                      const kopi = [...slides]
                      kopi[i] = { ...sl, params: { ...sl.params, [p.key]: Number(e.target.value) } }
                      setSlides(kopi)
                    }}
                    className="mt-1 w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900"
                  />
                </label>
              ))}

              <label className="flex flex-col text-xs font-medium text-gray-500">
                Sekunder
                <input
                  type="number" min={5} max={600}
                  value={sl.durationSec}
                  onChange={e => {
                    const kopi = [...slides]
                    kopi[i] = { ...sl, durationSec: Number(e.target.value) }
                    setSlides(kopi)
                  }}
                  className="mt-1 w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900"
                />
              </label>

              <button
                onClick={() => setSlides(slides.filter((_, j) => j !== i))}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Fjern
              </button>
            </div>
          )
        })}

        <div className="flex flex-wrap items-center gap-2">
          <select
            value=""
            onChange={e => { if (e.target.value) tilfoej(e.target.value) }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900"
          >
            <option value="">Tilføj BC-widget …</option>
            {katalog.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <button
            onClick={gem}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Gem indhold
          </button>
          {gemt && <span className="text-sm text-emerald-600">Gemt — skærmen skifter selv inden for et halvt minut.</span>}
        </div>
      </div>
    </div>
  )
}
