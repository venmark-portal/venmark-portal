'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Star, CheckCircle2, XCircle, User } from 'lucide-react'

interface Driver {
  id: string
  name: string
  phone: string | null
  email: string | null
  isDefault: boolean
  isActive: boolean
  defaultVehicleLabel: string
}

const EMPTY: Omit<Driver, 'id'> & { pin: string } = {
  name: '', phone: '', email: '', pin: '', isDefault: false, isActive: true, defaultVehicleLabel: 'Bil 1',
}

export default function ChauffoererPage() {
  const [drivers, setDrivers]   = useState<Driver[]>([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState<null | 'new' | Driver>(null)
  const [form, setForm]         = useState({ ...EMPTY })
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  async function load() {
    const r = await fetch('/api/admin/chauffoerer')
    setDrivers(await r.json())
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function openNew() {
    setForm({ ...EMPTY })
    setError('')
    setModal('new')
  }

  function openEdit(d: Driver) {
    setForm({ name: d.name, phone: d.phone ?? '', email: d.email ?? '', pin: '', isDefault: d.isDefault, isActive: d.isActive, defaultVehicleLabel: d.defaultVehicleLabel ?? 'Bil 1' })
    setError('')
    setModal(d)
  }

  async function save() {
    if (!form.name.trim()) { setError('Navn er påkrævet'); return }
    if (modal === 'new' && (!form.pin || form.pin.length < 4)) { setError('PIN skal være mindst 4 cifre'); return }
    setSaving(true); setError('')
    try {
      const isNew = modal === 'new'
      const res = await fetch(isNew ? '/api/admin/chauffoerer' : `/api/admin/chauffoerer/${(modal as Driver).id}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Fejl')
      await load()
      setModal(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function del(id: string, name: string) {
    if (!confirm(`Slet ${name}?`)) return
    await fetch(`/api/admin/chauffoerer/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chauffører</h1>
          <p className="text-sm text-gray-500">Administrer chauffører og deres PIN-koder</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          <Plus size={16} /> Ny chauffør
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Indlæser…</p>
      ) : drivers.length === 0 ? (
        <div className="rounded-xl bg-white p-10 text-center ring-1 ring-gray-200">
          <User size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm text-gray-500">Ingen chauffører endnu</p>
          <button onClick={openNew} className="mt-4 text-sm text-blue-600 hover:underline">Opret den første</button>
        </div>
      ) : (
        <div className="rounded-xl bg-white ring-1 ring-gray-200 divide-y divide-gray-100">
          {drivers.map(d => (
            <div key={d.id} className="flex items-center gap-4 px-5 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm shrink-0">
                {d.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{d.name}</span>
                  {d.isDefault && (
                    <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      <Star size={10} /> Standard
                    </span>
                  )}
                  {!d.isActive && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">Inaktiv</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                  {d.phone && <span>📞 {d.phone}</span>}
                  {d.email && <span>✉️ {d.email}</span>}
                  <span className="text-gray-400">🚛 {d.defaultVehicleLabel ?? 'Bil 1'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => openEdit(d)}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                  <Pencil size={15} />
                </button>
                <button onClick={() => del(d.id, d.name)}
                  className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-bold text-gray-900">
              {modal === 'new' ? 'Ny chauffør' : `Rediger ${(modal as Driver).name}`}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Navn *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  placeholder="Anders Jensen" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Telefon</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                    placeholder="20123456" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Email</label>
                  <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                    placeholder="a@venmark.dk" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  PIN-kode {modal !== 'new' && '(lad stå tom for at beholde eksisterende)'}
                </label>
                <input value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono tracking-widest focus:border-blue-400 focus:outline-none"
                  placeholder="4-6 cifre" maxLength={6} inputMode="numeric" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Standard bil</label>
                <input value={form.defaultVehicleLabel} onChange={e => setForm(f => ({ ...f, defaultVehicleLabel: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  placeholder="Bil 1" />
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.isDefault}
                    onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
                    className="rounded" />
                  <span className="text-sm text-gray-700">Standardchauffør</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.isActive}
                    onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                    className="rounded" />
                  <span className="text-sm text-gray-700">Aktiv</span>
                </label>
              </div>
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
