'use client'

// Admin for info-skærme: skærme, grupper og adgang.
//
// Widget-kataloget kommer fra serveren — man kan vælge mellem widgets og sætte
// deres parametre, men aldrig ændre forespørgslen. Serveren håndhæver desuden
// rollen igen; det UI'et skjuler her er kun for at holde fladen ryddelig.

import { useEffect, useState } from 'react'

interface ParamDef { key: string; label: string; type: string; default: number; min: number; max: number }
interface WidgetDef { id: string; name: string; description: string; ttlSec: number; params: ParamDef[] }

interface Schedule { from?: string; to?: string; timeFrom?: string; timeTo?: string; weekdays?: number[] }
interface Slide {
  widgetId: string; params: Record<string, number>; durationSec: number
  zone: 'main' | 'ticker'; schedule?: Schedule
}
interface Gruppe { id: string; name: string }
interface Screen {
  id: string; name: string; token: string
  orientation: 'landscape' | 'portrait'
  layout: 'single' | 'split'
  groupId: string | null
  slides: Slide[]; active: boolean
  lastHeartbeat: string | null
  minRolle: 'viewer' | 'editor' | 'admin' | null
}
interface Bruger { id: string; name: string; email: string; signageLimited: boolean }
interface Tildeling {
  id: string; userId: string; screenId: string | null; groupId: string | null
  role: string; userName: string; userEmail: string
}

const HEARTBEAT_GRAENSE_MS = 2 * 60 * 1000
const UGEDAGE = [
  { n: 1, k: 'M' }, { n: 2, k: 'T' }, { n: 3, k: 'O' }, { n: 4, k: 'T' },
  { n: 5, k: 'F' }, { n: 6, k: 'L' }, { n: 7, k: 'S' },
]

const RANG = { viewer: 1, editor: 2, admin: 3 } as const
const maa = (s: Screen, k: keyof typeof RANG) => s.minRolle !== null && RANG[s.minRolle] >= RANG[k]

export default function SkaermeAdmin({ baseUrl }: { baseUrl: string }) {
  const [screens, setScreens] = useState<Screen[]>([])
  const [grupper, setGrupper] = useState<Gruppe[]>([])
  const [katalog, setKatalog] = useState<WidgetDef[]>([])
  const [superadmin, setSuperadmin] = useState(false)
  const [henter, setHenter] = useState(true)
  const [fane, setFane] = useState<'skaerme' | 'grupper' | 'adgang'>('skaerme')

  async function hent() {
    const res = await fetch('/api/admin/skaerme', { cache: 'no-store' })
    if (res.ok) {
      const d = await res.json()
      setScreens(d.screens ?? [])
      setGrupper(d.grupper ?? [])
      setKatalog(d.katalog ?? [])
      setSuperadmin(Boolean(d.superadmin))
    }
    setHenter(false)
  }
  useEffect(() => { hent() }, [])

  if (henter) return <p className="text-sm text-gray-500">Henter skærme …</p>

  return (
    <div className="space-y-6">
      {superadmin && (
        <div className="flex gap-1 border-b border-gray-200">
          {([['skaerme', 'Skærme'], ['grupper', 'Grupper'], ['adgang', 'Adgang']] as const).map(([id, navn]) => (
            <button
              key={id}
              onClick={() => setFane(id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                fane === id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {navn}
            </button>
          ))}
        </div>
      )}

      {fane === 'skaerme' && (
        <Skaerme
          screens={screens} grupper={grupper} katalog={katalog}
          superadmin={superadmin} baseUrl={baseUrl} onOpdater={hent}
        />
      )}
      {fane === 'grupper' && superadmin && <Grupper grupper={grupper} screens={screens} onOpdater={hent} />}
      {fane === 'adgang'  && superadmin && <Adgang  grupper={grupper} screens={screens} />}
    </div>
  )
}

// ─── Skærme ──────────────────────────────────────────────────────────────────

function Skaerme({
  screens, grupper, katalog, superadmin, baseUrl, onOpdater,
}: {
  screens: Screen[]; grupper: Gruppe[]; katalog: WidgetDef[]
  superadmin: boolean; baseUrl: string; onOpdater: () => Promise<void>
}) {
  const [navn, setNavn] = useState('')
  const [retning, setRetning] = useState<'landscape' | 'portrait'>('landscape')
  const [layout, setLayout] = useState<'single' | 'split'>('single')
  const [gruppe, setGruppe] = useState('')

  async function opret() {
    if (!navn.trim()) return
    await fetch('/api/admin/skaerme', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: navn.trim(), orientation: retning, layout, groupId: gruppe || null }),
    })
    setNavn('')
    onOpdater()
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/skaerme/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? 'Kunne ikke gemmes')
    onOpdater()
  }

  async function slet(s: Screen) {
    if (!confirm(`Slet skærmen "${s.name}"? URL'en holder op med at virke.`)) return
    await fetch(`/api/admin/skaerme/${s.id}`, { method: 'DELETE' })
    onOpdater()
  }

  // Gruppér visningen, så fx alle lager-skærme står samlet.
  const iGruppe = (id: string | null) => screens.filter(s => s.groupId === id)
  const sektioner = [
    ...grupper.map(g => ({ navn: g.name, skaerme: iGruppe(g.id) })),
    { navn: 'Uden gruppe', skaerme: iGruppe(null) },
  ].filter(s => s.skaerme.length > 0)

  return (
    <div className="space-y-8">
      {superadmin && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Opret skærm</h2>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Felt label="Navn">
              <input value={navn} onChange={e => setNavn(e.target.value)} placeholder="fx Lager 1"
                     className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none" />
            </Felt>
            <Felt label="Gruppe">
              <select value={gruppe} onChange={e => setGruppe(e.target.value)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900">
                <option value="">Ingen</option>
                {grupper.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Felt>
            <Felt label="Retning">
              <select value={retning} onChange={e => setRetning(e.target.value as any)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900">
                <option value="landscape">Landskab</option>
                <option value="portrait">Portræt</option>
              </select>
            </Felt>
            <Felt label="Layout">
              <select value={layout} onChange={e => setLayout(e.target.value as any)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900">
                <option value="single">Én zone</option>
                <option value="split">BC øverst + slide-bånd</option>
              </select>
            </Felt>
            <button onClick={opret} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
              Opret
            </button>
          </div>
        </div>
      )}

      {screens.length === 0 && <p className="text-sm text-gray-500">Du har ikke adgang til nogen skærme endnu.</p>}

      {sektioner.map(sek => (
        <div key={sek.navn} className="space-y-4">
          {sektioner.length > 1 && (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{sek.navn}</h2>
          )}
          {sek.skaerme.map(s => (
            <SkaermKort key={s.id} screen={s} grupper={grupper} katalog={katalog}
                        superadmin={superadmin} baseUrl={baseUrl} onPatch={patch} onSlet={slet} />
          ))}
        </div>
      ))}
    </div>
  )
}

function SkaermKort({
  screen, grupper, katalog, superadmin, baseUrl, onPatch, onSlet,
}: {
  screen: Screen; grupper: Gruppe[]; katalog: WidgetDef[]
  superadmin: boolean; baseUrl: string
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>
  onSlet: (s: Screen) => Promise<void>
}) {
  const [slides, setSlides] = useState<Slide[]>(screen.slides)
  const [gemt, setGemt] = useState(false)

  const url    = `${baseUrl}/skaerm/${screen.token}`
  const online = screen.lastHeartbeat
    ? Date.now() - new Date(screen.lastHeartbeat).getTime() < HEARTBEAT_GRAENSE_MS
    : false
  const kanRedigere = maa(screen, 'editor')
  const kanAdmin    = maa(screen, 'admin')

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
      zone: 'main',
    }])
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`h-3 w-3 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-400'}`}
                title={screen.lastHeartbeat ? `Sidste livstegn: ${new Date(screen.lastHeartbeat).toLocaleString('da-DK')}` : 'Aldrig set'} />
          <div>
            <h3 className="font-semibold text-gray-900">{screen.name}</h3>
            <p className="text-xs text-gray-500">
              {screen.orientation === 'portrait' ? 'Portræt' : 'Landskab'} ·{' '}
              {screen.layout === 'split' ? 'BC øverst + slide-bånd' : 'én zone'} ·{' '}
              {screen.lastHeartbeat
                ? `sidste livstegn ${new Date(screen.lastHeartbeat).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}`
                : 'ingen livstegn endnu'}
              {screen.minRolle && screen.minRolle !== 'admin' && ` · din rolle: ${screen.minRolle}`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a href={url} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">Åbn</a>
          <button onClick={() => navigator.clipboard?.writeText(url)} className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">Kopiér URL</button>
          {kanRedigere && (
            <button onClick={() => onPatch(screen.id, { active: !screen.active })} className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">
              {screen.active ? 'Deaktivér' : 'Aktivér'}
            </button>
          )}
          {kanAdmin && (
            <button
              onClick={() => { if (confirm('Nyt token? Den gamle URL holder øjeblikkeligt op med at virke, og skærmen skal have den nye.')) onPatch(screen.id, { rotateToken: true }) }}
              className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">Nyt token</button>
          )}
          {superadmin && (
            <button onClick={() => onSlet(screen)} className="rounded-lg border border-red-200 px-3 py-1.5 text-red-600 hover:bg-red-50">Slet</button>
          )}
        </div>
      </div>

      <p className="mt-3 break-all rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600">{url}</p>
      {!screen.active && <p className="mt-2 text-xs font-medium text-red-600">Deaktiveret — URL&apos;en svarer 404.</p>}

      {kanAdmin && (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4">
          <Felt label="Gruppe">
            <select value={screen.groupId ?? ''} onChange={e => onPatch(screen.id, { groupId: e.target.value || null })}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900">
              <option value="">Ingen</option>
              {grupper.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Felt>
          <Felt label="Layout">
            <select value={screen.layout} onChange={e => onPatch(screen.id, { layout: e.target.value })}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900">
              <option value="single">Én zone</option>
              <option value="split">BC øverst + slide-bånd</option>
            </select>
          </Felt>
        </div>
      )}

      {kanRedigere && (
        <div className="mt-4 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Indhold</h4>
          {slides.map((sl, i) => (
            <SlideRaekke
              key={i} slide={sl} katalog={katalog} visZone={screen.layout === 'split'}
              onSkift={ny => { const k = [...slides]; k[i] = ny; setSlides(k) }}
              onFjern={() => setSlides(slides.filter((_, j) => j !== i))}
            />
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <select value="" onChange={e => { if (e.target.value) tilfoej(e.target.value) }}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900">
              <option value="">Tilføj BC-widget …</option>
              {katalog.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button onClick={gem} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">Gem indhold</button>
            {gemt && <span className="text-sm text-emerald-600">Gemt — skærmen skifter selv inden for et halvt minut.</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function SlideRaekke({
  slide, katalog, visZone, onSkift, onFjern,
}: {
  slide: Slide; katalog: WidgetDef[]; visZone: boolean
  onSkift: (s: Slide) => void; onFjern: () => void
}) {
  const w = katalog.find(k => k.id === slide.widgetId)
  const harPlan = Boolean(slide.schedule && Object.keys(slide.schedule).length > 0)
  const [vis, setVis] = useState(harPlan)
  const p = slide.schedule ?? {}

  const saetPlan = (patch: Partial<Schedule>) => {
    const ny: Schedule = { ...p, ...patch }
    for (const k of Object.keys(ny) as (keyof Schedule)[]) {
      const v = ny[k]
      if (v === '' || v === undefined || (Array.isArray(v) && v.length === 0)) delete ny[k]
    }
    onSkift({ ...slide, schedule: Object.keys(ny).length ? ny : undefined })
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <div className="text-sm font-medium text-gray-900">{w?.name ?? slide.widgetId}</div>
          <div className="text-xs text-gray-500">{w?.description}</div>
        </div>

        {w?.params.map(pd => (
          <Felt key={pd.key} label={pd.label}>
            <input type="number" min={pd.min} max={pd.max} value={slide.params[pd.key] ?? pd.default}
                   onChange={e => onSkift({ ...slide, params: { ...slide.params, [pd.key]: Number(e.target.value) } })}
                   className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900" />
          </Felt>
        ))}

        <Felt label="Sekunder">
          <input type="number" min={5} max={600} value={slide.durationSec}
                 onChange={e => onSkift({ ...slide, durationSec: Number(e.target.value) })}
                 className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900" />
        </Felt>

        {visZone && (
          <Felt label="Zone">
            <select value={slide.zone} onChange={e => onSkift({ ...slide, zone: e.target.value as any })}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900">
              <option value="main">Øverst (BC)</option>
              <option value="ticker">Slide-bånd</option>
            </select>
          </Felt>
        )}

        <button onClick={() => setVis(v => !v)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${harPlan ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          {harPlan ? 'Tidsplan ✓' : 'Tidsplan'}
        </button>
        <button onClick={onFjern} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Fjern</button>
      </div>

      {vis && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3">
          <Felt label="Fra dato">
            <input type="date" value={p.from ?? ''} onChange={e => saetPlan({ from: e.target.value })}
                   className="rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900" />
          </Felt>
          <Felt label="Til dato">
            <input type="date" value={p.to ?? ''} onChange={e => saetPlan({ to: e.target.value })}
                   className="rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900" />
          </Felt>
          <Felt label="Fra kl.">
            <input type="time" value={p.timeFrom ?? ''} onChange={e => saetPlan({ timeFrom: e.target.value })}
                   className="rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900" />
          </Felt>
          <Felt label="Til kl.">
            <input type="time" value={p.timeTo ?? ''} onChange={e => saetPlan({ timeTo: e.target.value })}
                   className="rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900" />
          </Felt>
          <Felt label="Ugedage">
            <div className="flex gap-1">
              {UGEDAGE.map(d => {
                const valgt = p.weekdays?.includes(d.n) ?? false
                return (
                  <button key={d.n} type="button"
                    onClick={() => {
                      const nu = new Set(p.weekdays ?? [])
                      if (nu.has(d.n)) nu.delete(d.n); else nu.add(d.n)
                      saetPlan({ weekdays: Array.from(nu).sort((a, b) => a - b) })
                    }}
                    className={`h-7 w-7 rounded text-xs font-semibold ${valgt ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                    {d.k}
                  </button>
                )
              })}
            </div>
          </Felt>
          <p className="w-full text-xs text-gray-500">
            Tomme felter = ingen begrænsning, og ingen ugedage valgt = alle dage. Tidspunkter er dansk
            tid, og et vindue må gerne gå hen over midnat (fx 22:00–06:00).
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Grupper ─────────────────────────────────────────────────────────────────

function Grupper({ grupper, screens, onOpdater }: { grupper: Gruppe[]; screens: Screen[]; onOpdater: () => Promise<void> }) {
  const [navn, setNavn] = useState('')

  async function opret() {
    if (!navn.trim()) return
    await fetch('/api/admin/skaermgrupper', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: navn.trim() }),
    })
    setNavn(''); onOpdater()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Opret gruppe</h2>
        <p className="mt-1 text-xs text-gray-500">
          Grupper gør det muligt at give adgang til fx alle lager-skærme på én gang.
        </p>
        <div className="mt-3 flex items-end gap-3">
          <input value={navn} onChange={e => setNavn(e.target.value)} placeholder="fx Lager"
                 className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900" />
          <button onClick={opret} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">Opret</button>
        </div>
      </div>

      {grupper.map(g => {
        const antal = screens.filter(s => s.groupId === g.id).length
        return (
          <div key={g.id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
            <div>
              <div className="font-medium text-gray-900">{g.name}</div>
              <div className="text-xs text-gray-500">{antal} skærm{antal === 1 ? '' : 'e'}</div>
            </div>
            <div className="flex gap-2 text-sm">
              <button
                onClick={async () => {
                  const nyt = prompt('Nyt navn', g.name)
                  if (!nyt?.trim()) return
                  await fetch(`/api/admin/skaermgrupper/${g.id}`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nyt.trim() }),
                  })
                  onOpdater()
                }}
                className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">Omdøb</button>
              <button
                onClick={async () => {
                  if (!confirm(`Slet gruppen "${g.name}"? Skærmene bliver, men mister deres gruppe — og adgange givet via gruppen forsvinder.`)) return
                  await fetch(`/api/admin/skaermgrupper/${g.id}`, { method: 'DELETE' })
                  onOpdater()
                }}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-red-600 hover:bg-red-50">Slet</button>
            </div>
          </div>
        )
      })}
      {grupper.length === 0 && <p className="text-sm text-gray-500">Ingen grupper endnu.</p>}
    </div>
  )
}

// ─── Adgang ──────────────────────────────────────────────────────────────────

function Adgang({ grupper, screens }: { grupper: Gruppe[]; screens: Screen[] }) {
  const [brugere, setBrugere] = useState<Bruger[]>([])
  const [tildelinger, setTildelinger] = useState<Tildeling[]>([])
  const [bruger, setBruger] = useState('')
  const [maal, setMaal] = useState('')
  const [rolle, setRolle] = useState('editor')

  async function hent() {
    const res = await fetch('/api/admin/skaermadgang', { cache: 'no-store' })
    if (res.ok) { const d = await res.json(); setBrugere(d.brugere ?? []); setTildelinger(d.tildelinger ?? []) }
  }
  useEffect(() => { hent() }, [])

  async function tildel() {
    if (!bruger || !maal) return
    const [slags, id] = maal.split(':')
    await fetch('/api/admin/skaermadgang', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: bruger, role: rolle,
        screenId: slags === 'skaerm' ? id : null,
        groupId:  slags === 'gruppe' ? id : null,
      }),
    })
    setMaal(''); hent()
  }

  const navnPaaMaal = (t: Tildeling) =>
    t.screenId ? (screens.find(s => s.id === t.screenId)?.name ?? 'ukendt skærm')
               : `${grupper.find(g => g.id === t.groupId)?.name ?? 'ukendt gruppe'} (gruppe)`

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Begrænsede brugere</h2>
        <p className="mt-1 text-xs text-gray-500">
          En almindelig portal-admin kan alt — også alle skærme. Sæt fluebenet for en bruger der
          <strong> kun</strong> skal have skærme: så kommer hun ikke ind på kunder, ordrer og fakturaer,
          og ser udelukkende det hun er tildelt nedenfor.
        </p>
        <div className="mt-3 space-y-2">
          {brugere.map(u => (
            <label key={u.id} className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={u.signageLimited}
                     onChange={async e => {
                       const res = await fetch('/api/admin/skaermadgang', {
                         method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify({ userId: u.id, limited: e.target.checked }),
                       })
                       if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? 'Kunne ikke ændres')
                       hent()
                     }}
                     className="h-4 w-4 rounded border-gray-300" />
              <span className="text-gray-900">{u.name}</span>
              <span className="text-gray-500">{u.email}</span>
              {u.signageLimited && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">kun skærme</span>}
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Giv adgang</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Felt label="Bruger">
            <select value={bruger} onChange={e => setBruger(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900">
              <option value="">Vælg …</option>
              {brugere.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Felt>
          <Felt label="Skærm eller gruppe">
            <select value={maal} onChange={e => setMaal(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900">
              <option value="">Vælg …</option>
              {grupper.map(g => <option key={g.id} value={`gruppe:${g.id}`}>{g.name} (hele gruppen)</option>)}
              {screens.map(s => <option key={s.id} value={`skaerm:${s.id}`}>{s.name}</option>)}
            </select>
          </Felt>
          <Felt label="Rolle">
            <select value={rolle} onChange={e => setRolle(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900">
              <option value="viewer">Viewer — må kun se</option>
              <option value="editor">Editor — må styre indhold</option>
              <option value="admin">Admin — også layout og token</option>
            </select>
          </Felt>
          <button onClick={tildel} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">Tildel</button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Tildelinger</h2>
        {tildelinger.length === 0 && <p className="mt-2 text-sm text-gray-500">Ingen tildelinger endnu.</p>}
        <div className="mt-3 space-y-2">
          {tildelinger.map(t => (
            <div key={t.id} className="flex items-center justify-between border-b border-gray-100 pb-2 text-sm">
              <span className="text-gray-900">
                <strong>{t.userName}</strong> — {navnPaaMaal(t)} · <span className="text-gray-500">{t.role}</span>
              </span>
              <button
                onClick={async () => { await fetch(`/api/admin/skaermadgang?id=${t.id}`, { method: 'DELETE' }); hent() }}
                className="rounded-lg border border-gray-300 px-3 py-1 text-gray-600 hover:bg-gray-50">Fjern</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Felt({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col text-xs font-medium text-gray-500">
      {label}
      <span className="mt-1">{children}</span>
    </label>
  )
}
