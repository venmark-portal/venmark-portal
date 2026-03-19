'use client'

import { useState, useTransition } from 'react'
import { createCustomer, updateCustomer, toggleCustomerActive } from '@/app/admin/(protected)/kunder/actions'
import { UserPlus, Pencil, ToggleLeft, ToggleRight, X, Loader2, CheckCircle2 } from 'lucide-react'

type Customer = {
  id:                  string
  name:                string
  email:               string
  bcCustomerNumber:    string
  bcPriceGroup:        string | null
  bcStandardSalesCode: string | null
  isActive:            boolean
  createdAt:           Date
  _count:              { orders: number }
}

const EMPTY_FORM = {
  name: '', email: '', password: '', bcCustomerNumber: '', bcPriceGroup: '', bcStandardSalesCode: '',
}

export default function CustomerManager({ initialCustomers }: { initialCustomers: Customer[] }) {
  const [customers,  setCustomers]  = useState(initialCustomers)
  const [modalOpen,  setModalOpen]  = useState(false)
  const [editing,    setEditing]    = useState<Customer | null>(null)
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [error,      setError]      = useState<string | null>(null)
  const [isPending,  startTransition] = useTransition()

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setModalOpen(true)
  }

  function openEdit(c: Customer) {
    setEditing(c)
    setForm({
      name:                c.name,
      email:               c.email,
      password:            '',
      bcCustomerNumber:    c.bcCustomerNumber,
      bcPriceGroup:        c.bcPriceGroup ?? '',
      bcStandardSalesCode: c.bcStandardSalesCode ?? '',
    })
    setError(null)
    setModalOpen(true)
  }

  function handleSubmit() {
    if (!form.name || !form.email || !form.bcCustomerNumber) {
      setError('Udfyld navn, email og BC-kundenummer')
      return
    }
    if (!editing && !form.password) {
      setError('Adgangskode er påkrævet ved oprettelse')
      return
    }

    startTransition(async () => {
      try {
        if (editing) {
          await updateCustomer(editing.id, form)
          setCustomers((prev) => prev.map((c) => c.id === editing.id
            ? { ...c, name: form.name, email: form.email, bcCustomerNumber: form.bcCustomerNumber, bcPriceGroup: form.bcPriceGroup || null, bcStandardSalesCode: form.bcStandardSalesCode || null }
            : c
          ))
        } else {
          const newCustomer = await createCustomer(form)
          setCustomers((prev) => [...prev, newCustomer])
        }
        setModalOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fejl ved gemning')
      }
    })
  }

  function handleToggle(id: string) {
    startTransition(async () => {
      await toggleCustomerActive(id)
      setCustomers((prev) =>
        prev.map((c) => c.id === id ? { ...c, isActive: !c.isActive } : c)
      )
    })
  }

  return (
    <>
      {/* ── Handlingsbar ── */}
      <div className="flex justify-end">
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <UserPlus size={16} />
          Ny kunde
        </button>
      </div>

      {/* ── Kundetabel ── */}
      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3 text-left">Navn</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">BC-nr.</th>
              <th className="px-4 py-3 text-left">Prisgruppe</th>
              <th className="px-4 py-3 text-left">Std. Sales Code</th>
              <th className="px-4 py-3 text-right">Ordrer</th>
              <th className="px-4 py-3 text-center">Aktiv</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {customers.map((c) => (
              <tr key={c.id} className={`hover:bg-gray-50 ${!c.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                <td className="px-4 py-3 text-gray-500">{c.email}</td>
                <td className="px-4 py-3 font-mono text-xs">{c.bcCustomerNumber}</td>
                <td className="px-4 py-3 text-gray-500">{c.bcPriceGroup ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{c.bcStandardSalesCode ?? '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{c._count.orders}</td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => handleToggle(c.id)} disabled={isPending} title={c.isActive ? 'Deaktiver' : 'Aktiver'}>
                    {c.isActive
                      ? <ToggleRight size={20} className="text-green-500" />
                      : <ToggleLeft  size={20} className="text-gray-400"  />}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => openEdit(c)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Pencil size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {customers.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-gray-400">
            Ingen kunder endnu — klik "Ny kunde" for at oprette en
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editing ? 'Rediger kunde' : 'Ny kunde'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="rounded-full p-1 hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-5">
              {error && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              )}

              {[
                { label: 'Navn',                                                        key: 'name',                type: 'text',     ph: 'Fisk A/S'       },
                { label: 'Email',                                                       key: 'email',               type: 'email',    ph: 'kunde@email.dk' },
                { label: editing ? 'Ny adgangskode (tom = behold)' : 'Adgangskode',    key: 'password',            type: 'password', ph: '••••••••'        },
                { label: 'BC-kundenummer',                                              key: 'bcCustomerNumber',    type: 'text',     ph: '98945965'        },
                { label: 'Prisgruppe (valgfri)',                                        key: 'bcPriceGroup',        type: 'text',     ph: 'FISK-GROSS'      },
                { label: 'Standard Sales Code (favoritliste)',                          key: 'bcStandardSalesCode', type: 'text',     ph: '9999FHSJÆ'       },
              ].map(({ label, key, type, ph }) => (
                <div key={key}>
                  <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
                  <input
                    type={type}
                    placeholder={ph}
                    value={form[key as keyof typeof form]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Annuller
              </button>
              <button
                onClick={handleSubmit}
                disabled={isPending}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {editing ? 'Gem ændringer' : 'Opret kunde'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
