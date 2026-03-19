'use client'

import { useState, useEffect } from 'react'
import { Palette, Save, RotateCcw, Eye, EyeOff, CheckCircle2 } from 'lucide-react'

interface Settings {
  bgColor:         string
  bannerEnabled:   boolean
  bannerText:      string
  bannerBgColor:   string
  bannerTextColor: string
}

const DEFAULTS: Settings = {
  bgColor:         '#eff6ff',
  bannerEnabled:   false,
  bannerText:      '',
  bannerBgColor:   '#1e40af',
  bannerTextColor: '#ffffff',
}

// Hurtige farvevalg til baggrund
const BG_PRESETS = [
  { label: 'Lys blå',    color: '#eff6ff' },
  { label: 'Hvid',       color: '#ffffff' },
  { label: 'Lysgrå',     color: '#f9fafb' },
  { label: 'Lys grøn',   color: '#f0fdf4' },
  { label: 'Lys laks',   color: '#fff7ed' },
  { label: 'Lys lilla',  color: '#faf5ff' },
]

// Hurtige bannerfarver
const BANNER_PRESETS = [
  { label: 'Blå',        bg: '#1e40af', text: '#ffffff' },
  { label: 'Mørk blå',   bg: '#0f172a', text: '#ffffff' },
  { label: 'Grøn',       bg: '#15803d', text: '#ffffff' },
  { label: 'Rød',        bg: '#b91c1c', text: '#ffffff' },
  { label: 'Orange',     bg: '#c2410c', text: '#ffffff' },
  { label: 'Gul',        bg: '#fbbf24', text: '#1f2937' },
  { label: 'Lyseblå',    bg: '#bfdbfe', text: '#1e3a8a' },
]

export default function UdseendePage() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    fetch('/api/admin/portal-settings')
      .then(r => r.json())
      .then(d => {
        setSettings({
          bgColor:         d.bgColor         ?? DEFAULTS.bgColor,
          bannerEnabled:   d.bannerEnabled    ?? DEFAULTS.bannerEnabled,
          bannerText:      d.bannerText       ?? '',
          bannerBgColor:   d.bannerBgColor    ?? DEFAULTS.bannerBgColor,
          bannerTextColor: d.bannerTextColor  ?? DEFAULTS.bannerTextColor,
        })
      })
      .catch(() => setError('Kunne ikke hente indstillinger'))
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true); setSaved(false); setError('')
    try {
      const res = await fetch('/api/admin/portal-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error(await res.text())
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setError(e.message ?? 'Ukendt fejl')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-12 text-center text-sm text-gray-400">Indlæser…</div>

  return (
    <div className="max-w-2xl space-y-6">

      <div className="flex items-center gap-3">
        <Palette size={22} className="text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Portal-udseende</h1>
          <p className="text-sm text-gray-500">Baggrundsfarve og banner der vises på alle kundesider</p>
        </div>
      </div>

      {/* ── Baggrundsfarve ── */}
      <section className="rounded-xl bg-white p-6 ring-1 ring-gray-200 space-y-4">
        <h2 className="font-semibold text-gray-800">Baggrundsfarve</h2>

        {/* Forhåndsvisning */}
        <div
          className="h-16 w-full rounded-lg border border-gray-200 flex items-center justify-center text-xs text-gray-500 transition-colors"
          style={{ backgroundColor: settings.bgColor }}
        >
          Baggrundsfarve forhåndsvisning
        </div>

        {/* Hurtige valg */}
        <div className="flex flex-wrap gap-2">
          {BG_PRESETS.map(p => (
            <button
              key={p.color}
              onClick={() => setSettings(s => ({ ...s, bgColor: p.color }))}
              title={p.label}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                settings.bgColor === p.color
                  ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-300'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <span
                className="h-3.5 w-3.5 rounded-full border border-gray-300 shrink-0"
                style={{ backgroundColor: p.color }}
              />
              {p.label}
            </button>
          ))}
        </div>

        {/* Manuel farve */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-gray-500 shrink-0">Brugerdefineret:</label>
          <input
            type="color"
            value={settings.bgColor}
            onChange={e => setSettings(s => ({ ...s, bgColor: e.target.value }))}
            className="h-8 w-12 cursor-pointer rounded border border-gray-200 p-0.5"
          />
          <code className="text-xs text-gray-500">{settings.bgColor}</code>
          <button
            onClick={() => setSettings(s => ({ ...s, bgColor: DEFAULTS.bgColor }))}
            className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            <RotateCcw size={11} /> Nulstil
          </button>
        </div>
      </section>

      {/* ── Banner ── */}
      <section className="rounded-xl bg-white p-6 ring-1 ring-gray-200 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Banner</h2>
          <button
            onClick={() => setSettings(s => ({ ...s, bannerEnabled: !s.bannerEnabled }))}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
              settings.bannerEnabled
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {settings.bannerEnabled ? <Eye size={12} /> : <EyeOff size={12} />}
            {settings.bannerEnabled ? 'Aktiveret' : 'Deaktiveret'}
          </button>
        </div>

        {/* Forhåndsvisning */}
        {settings.bannerText ? (
          <div
            className="w-full rounded-lg px-4 py-2.5 text-center text-sm font-medium transition-all"
            style={{
              backgroundColor: settings.bannerEnabled ? settings.bannerBgColor : '#e5e7eb',
              color:           settings.bannerEnabled ? settings.bannerTextColor : '#9ca3af',
            }}
          >
            {settings.bannerText}
            {!settings.bannerEnabled && <span className="ml-2 text-xs opacity-70">(deaktiveret)</span>}
          </div>
        ) : (
          <div className="h-10 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-400">
            Skriv banner-tekst nedenfor for at se forhåndsvisning
          </div>
        )}

        {/* Tekst */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Banner-tekst</label>
          <input
            type="text"
            value={settings.bannerText}
            onChange={e => setSettings(s => ({ ...s, bannerText: e.target.value }))}
            placeholder="f.eks. 🎉 Sommerpriser — bestil nu og spar op til 20%"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>

        {/* Farve-presets */}
        <div>
          <label className="mb-2 block text-xs font-medium text-gray-500">Farvetema</label>
          <div className="flex flex-wrap gap-2">
            {BANNER_PRESETS.map(p => (
              <button
                key={p.bg}
                onClick={() => setSettings(s => ({ ...s, bannerBgColor: p.bg, bannerTextColor: p.text }))}
                title={p.label}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  settings.bannerBgColor === p.bg
                    ? 'border-blue-500 ring-2 ring-blue-300'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                style={{ backgroundColor: p.bg, color: p.text }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Manuel farve */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">Baggrund:</label>
            <input
              type="color"
              value={settings.bannerBgColor}
              onChange={e => setSettings(s => ({ ...s, bannerBgColor: e.target.value }))}
              className="h-8 w-12 cursor-pointer rounded border border-gray-200 p-0.5"
            />
            <code className="text-xs text-gray-400">{settings.bannerBgColor}</code>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">Tekst:</label>
            <input
              type="color"
              value={settings.bannerTextColor}
              onChange={e => setSettings(s => ({ ...s, bannerTextColor: e.target.value }))}
              className="h-8 w-12 cursor-pointer rounded border border-gray-200 p-0.5"
            />
            <code className="text-xs text-gray-400">{settings.bannerTextColor}</code>
          </div>
        </div>
      </section>

      {/* Gem-knap */}
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-[0.98] transition disabled:opacity-50"
        >
          <Save size={16} />
          {saving ? 'Gemmer…' : 'Gem indstillinger'}
        </button>

        {saved && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-green-600">
            <CheckCircle2 size={16} />
            Gemt!
          </span>
        )}
      </div>
    </div>
  )
}
