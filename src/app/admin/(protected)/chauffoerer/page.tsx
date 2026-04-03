'use client'

import { useState, useEffect } from 'react'
import { RefreshCw, Pencil, Trash2, Star, User, KeyRound, Truck, AlertCircle, CheckCircle2 } from 'lucide-react'

interface Driver {
  id:                  string
  name:                string
  phone:               string | null
  isDefault:           boolean
  isActive:            boolean
  defaultVehicleLabel: string
  bcDriverCode:        string | null
}

export default function ChauffoererPage() {
  const [drivers,  setDrivers]  = useState<Driver[]>([])
  const [loading,  setLoading]  = useState(true)
  const [syncing,  setSyncing]  = useState(false)
  const [syncMsg,  setSyncMsg]  = useState<string | null>(null)
  const [modal,    setModal]    = useState<Driver | null>(null)
  const [pin,      setPin]      = useState('')
  const [vLabel,   setVLabel]   = useState('Bil 1')
  const [isDefault,setIsDefault]= useState(false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  async function load() {
    const r = await fetch('/api/admin/chauffoerer')
    setDrivers(await r.json())
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function syncFromBC() {
    setSyncing(true)
    setSyncMsg(null)
    const r    = await fetch('/api/admin/chauffoerer', { method: 'POST' })
    const data = await r.json()
    setSyncMsg(data.message ?? `Synkroniseret: ${data.created ?? 0} nye, ${data.updated ?? 0} opdaterede`)
    await load()
    setSyncing(false)
    setTimeout(() => setSyncMsg(null), 6000)
  }

  function openPin(d: Driver) {
    setModal(d)
    setPin('')
    setVLabel(d.defaultVehicleLabel ?? 'Bil 1')
    setIsDefault(d.isDefault)
    setError('')
  }

  async function save() {
    if (!modal) return
    if (pin && pin.length < 4) { setError('PIN skal være mindst 4 cifre'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/admin/chauffoerer/${modal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin || undefined, isDefault, defaultVehicleLabel: vLabel }),
      })
      if (!res.ok) throw new Error('Gem fejlede')
      await load()
      setModal(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function del(id: string, name: string) {
    if (!confirm(`Fjern ${name} fra portalen? (Chaufføren slettes ikke i BC)`)) return
    await fetch(`/api/admin/chauffoerer/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chauffører</h1>
          <p className="text-sm text-gray-500 mt-1">
            Chauffører oprettes og redigeres i BC (Portal Driver). Brug "Sync fra BC" for at hente dem herind og sæt derefter PIN-koder.
          </p>
        </div>
        <button
          onClick={syncFromBC}
          disabled={syncing}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Synkroniserer…' : 'Sync fra BC'}
        </button>
      </div>

      {syncMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 text-sm text-green-700">
          <CheckCircle2 size={15} /> {syncMsg}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Indlæser…</p>
      ) : drivers.length === 0 ? (
        <div className="rounded-xl bg-white p-10 text-center ring-1 ring-gray-200 space-y-3">
          <User size={32} className="mx-auto text-gray-300" />
          <p className="text-sm text-gray-500">Ingen chauffører endnu</p>
          <p className="text-xs text-gray-400">Opret chauffører i BC under Portal Driver, og tryk derefter "Sync fra BC"</p>
        </div>
      ) : (
        <div className="rounded-xl bg-white ring-1 ring-gray-200 divide-y divide-gray-100">
          {drivers.map(d => (
            <div key={d.id} className="flex items-center gap-4 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm">
                {d.name.slice(0, 2).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{d.name}</span>
                  {d.isDefault && (
                    <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      <Star size={10} /> Standard
                    </span>
                  )}
                  {!d.isActive && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">Inaktiv i BC</span>
                  )}
                  {!d.bcDriverCode && (
                    <span className="flex items-center gap-0.5 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-600">
                      <AlertCircle size={10} /> Ikke BC-synkroniseret
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                  {d.phone && <span>📞 {d.phone}</span>}
                  {d.bcDriverCode && <span className="font-mono text-gray-400">BC: {d.bcDriverCode}</span>}
                  <span className="flex items-center gap-1"><Truck size={10} /> {d.defaultVehicleLabel ?? 'Bil 1'}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openPin(d)}
                  title="Sæt PIN og præferencer"
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  <KeyRound size={13} /> PIN
                </button>
                <button
                  onClick={() => del(d.id, d.name)}
                  title="Fjern fra portal"
                  className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PIN-modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm">
                {modal.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h2 className="font-bold text-gray-900">{modal.name}</h2>
                {modal.bcDriverCode && <p className="text-xs text-gray-400 font-mono">BC: {modal.bcDriverCode}</p>}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  <KeyRound size={11} className="inline mr-1" />
                  Ny PIN-kode <span className="text-gray-400">(lad stå tom for at beholde)</span>
                </label>
                <input
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-center text-xl tracking-widest font-mono focus:border-blue-400 focus:outline-none"
                  placeholder="••••"
                  maxLength={8}
                  inputMode="numeric"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  <Truck size={11} className="inline mr-1" />
                  Standard bil
                </label>
                <input
                  value={vLabel}
                  onChange={e => setVLabel(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  placeholder="Bil 1"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={e => setIsDefault(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-gray-700">Standardchauffør</span>
              </label>
            </div>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={save} disabled={saving}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Gemmer…' : 'Gem'}
              </button>
              <button onClick={() => setModal(null)}
                className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                Annuller
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
