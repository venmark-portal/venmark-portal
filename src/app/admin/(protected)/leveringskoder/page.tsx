'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, UserPlus, X, Tag } from 'lucide-react'

interface Contact { id?: string; name: string; email: string; phone: string; role: string }
interface DeliveryCode { id: string; code: string; name: string; description: string | null; contacts: Contact[] }

const EMPTY_CODE = { code: '', name: '', description: '', contacts: [] as Contact[] }
const EMPTY_CONTACT: Contact = { name: '', email: '', phone: '', role: 'transporter' }

export default function LeveringskoderPage() {
  const [codes,   setCodes]   = useState<DeliveryCode[]>([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState<null | 'new' | DeliveryCode>(null)
  const [form,    setForm]    = useState({ ...EMPTY_CODE })
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  async function load() {
    const r = await fetch('/api/admin/leveringskoder')
    setCodes(await r.json())
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function openNew() {
    setForm({ ...EMPTY_CODE, contacts: [] })
    setError('')
    setModal('new')
  }

  function openEdit(c: DeliveryCode) {
    setForm({ code: c.code, name: c.name, description: c.description ?? '', contacts: c.contacts.map(ct => ({ ...ct })) })
    setError('')
    setModal(c)
  }

  function addContact() {
    setForm(f => ({ ...f, contacts: [...f.contacts, { ...EMPTY_CONTACT }] }))
  }

  function updateContact(i: number, field: keyof Contact, val: string) {
    setForm(f => {
      const contacts = [...f.contacts]
      contacts[i] = { ...contacts[i], [field]: val }
      return { ...f, contacts }
    })
  }

  function removeContact(i: number) {
    setForm(f => ({ ...f, contacts: f.contacts.filter((_, idx) => idx !== i) }))
  }

  async function save() {
    if (!form.code.trim() || !form.name.trim()) { setError('Kode og navn er påkrævet'); return }
    setSaving(true); setError('')
    try {
      const isNew = modal === 'new'
      const res = await fetch(isNew ? '/api/admin/leveringskoder' : `/api/admin/leveringskoder/${(modal as DeliveryCode).id}`, {
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
    await fetch(`/api/admin/leveringskoder/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leveringskoder</h1>
          <p className="text-sm text-gray-500">Koder med tilknyttede transportørkontakter</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          <Plus size={16} /> Ny kode
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Indlæser…</p>
      ) : codes.length === 0 ? (
        <div className="rounded-xl bg-white p-10 text-center ring-1 ring-gray-200">
          <Tag size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm text-gray-500">Ingen leveringskoder endnu</p>
          <button onClick={openNew} className="mt-4 text-sm text-blue-600 hover:underline">Opret den første</button>
        </div>
      ) : (
        <div className="space-y-3">
          {codes.map(c => (
            <div key={c.id} className="rounded-xl bg-white ring-1 ring-gray-200 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-blue-100 px-2.5 py-0.5 text-sm font-bold text-blue-800 font-mono">{c.code}</span>
                    <span className="font-semibold text-gray-900">{c.name}</span>
                  </div>
                  {c.description && <p className="mt-1 text-xs text-gray-500">{c.description}</p>}
                  {c.contacts.length > 0 && (
                    <div className="mt-2 space-y-0.5">
                      {c.contacts.map((ct, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                          <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${ct.role === 'transporter' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                            {ct.role === 'transporter' ? 'Transportør' : 'Intern'}
                          </span>
                          <span className="font-medium">{ct.name}</span>
                          {ct.email && <span className="text-gray-400">· {ct.email}</span>}
                          {ct.phone && <span className="text-gray-400">· {ct.phone}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(c)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Pencil size={15} /></button>
                  <button onClick={() => del(c.id, c.name)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal !== null && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 py-8 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-bold text-gray-900">
              {modal === 'new' ? 'Ny leveringskode' : `Rediger ${(modal as DeliveryCode).code}`}
            </h2>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Kode *</label>
                  <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase focus:border-blue-400 focus:outline-none"
                    placeholder="DSV" maxLength={10} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Navn *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                    placeholder="DSV Transport" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Beskrivelse</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  placeholder="Valgfri noter" />
              </div>

              {/* Kontakter */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Kontakter</label>
                  <button onClick={addContact} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <UserPlus size={12} /> Tilføj kontakt
                  </button>
                </div>
                {form.contacts.length === 0 && (
                  <p className="text-xs text-gray-400 italic">Ingen kontakter — klik "Tilføj kontakt"</p>
                )}
                <div className="space-y-3">
                  {form.contacts.map((ct, i) => (
                    <div key={i} className="rounded-lg bg-gray-50 p-3 space-y-2 relative">
                      <button onClick={() => removeContact(i)} className="absolute right-2 top-2 text-gray-400 hover:text-red-500"><X size={14} /></button>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-0.5 block text-xs text-gray-500">Navn *</label>
                          <input value={ct.name} onChange={e => updateContact(i, 'name', e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
                            placeholder="Lars Hansen" />
                        </div>
                        <div>
                          <label className="mb-0.5 block text-xs text-gray-500">Rolle</label>
                          <select value={ct.role} onChange={e => updateContact(i, 'role', e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none bg-white">
                            <option value="transporter">Transportør</option>
                            <option value="internal">Intern</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-0.5 block text-xs text-gray-500">Email</label>
                          <input value={ct.email} onChange={e => updateContact(i, 'email', e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
                            placeholder="lars@dsv.dk" />
                        </div>
                        <div>
                          <label className="mb-0.5 block text-xs text-gray-500">Telefon</label>
                          <input value={ct.phone} onChange={e => updateContact(i, 'phone', e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
                            placeholder="70123456" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
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
