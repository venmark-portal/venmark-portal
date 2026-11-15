'use client'

import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Boxes, Lock, User } from 'lucide-react'

interface Bruger {
  id: string
  name: string
  initials: string
}

export default function LagerLoginPage() {
  const router = useRouter()
  const [brugere, setBrugere] = useState<Bruger[]>([])
  const [brugerId, setBrugerId] = useState('')
  const [pin, setPin] = useState('')
  const [fejl, setFejl] = useState('')
  const [travl, setTravl] = useState(false)

  useEffect(() => {
    fetch('/api/lager/brugere')
      .then(r => r.json())
      .then((rows: Bruger[]) => {
        setBrugere(rows)
        if (rows.length > 0) setBrugerId(rows[0].id)
      })
      .catch(() => {})
  }, [])

  async function login(e: React.FormEvent) {
    e.preventDefault()
    if (!brugerId || !pin) return
    setTravl(true)
    setFejl('')
    const svar = await signIn('lager', { userId: brugerId, pin, redirect: false })
    if (svar?.ok) {
      router.push('/lager')
    } else {
      setFejl('Forkert PIN — prøv igen')
      setPin('')
    }
    setTravl(false)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-700 text-white">
            <Boxes size={28} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Venmark Lager</h1>
          <p className="mt-1 text-sm text-gray-500">Vælg dit navn og tast din PIN</p>
        </div>

        <form onSubmit={login} className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <User size={14} /> Hvem er du?
            </label>
            <select
              value={brugerId}
              onChange={e => setBrugerId(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base focus:border-emerald-600 focus:outline-none"
            >
              {brugere.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              {brugere.length === 0 && <option value="">Ingen lagerbrugere oprettet</option>}
            </select>
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Lock size={14} /> PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={e => setPin(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-3 text-center text-2xl tracking-[0.5em] focus:border-emerald-600 focus:outline-none"
              placeholder="••••"
            />
          </div>

          {fejl && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{fejl}</p>}

          <button
            type="submit"
            disabled={travl || !brugerId || !pin}
            className="w-full rounded-xl bg-emerald-700 py-3.5 text-base font-semibold text-white disabled:opacity-40"
          >
            {travl ? 'Logger ind …' : 'Log ind'}
          </button>
        </form>
      </div>
    </div>
  )
}
