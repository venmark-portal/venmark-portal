'use client'

import { useState, useEffect } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Truck, Lock, User } from 'lucide-react'

interface Driver {
  id:   string
  name: string
}

export default function ChauffeurLoginPage() {
  const router   = useRouter()
  const [drivers,  setDrivers]  = useState<Driver[]>([])
  const [driverId, setDriverId] = useState('')
  const [pin,      setPin]      = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  useEffect(() => {
    fetch('/api/admin/chauffoerer')
      .then(r => r.json())
      .then((rows: any[]) => {
        const active = rows.filter(d => d.isActive !== false)
        setDrivers(active)
        if (active.length > 0) setDriverId(active[0].id)
      })
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!driverId || !pin) return
    setLoading(true)
    setError('')

    const result = await signIn('driver', {
      driverId,
      pin,
      redirect: false,
    })

    if (result?.ok) {
      router.push('/chauffeur/rute')
    } else {
      setError('Forkert PIN — prøv igen')
      setPin('')
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white">
            <Truck size={28} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Venmark Chauffør</h1>
          <p className="mt-1 text-sm text-gray-500">Log ind med dit navn og din PIN-kode</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          {/* Vælg chauffør */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <User size={14} /> Hvem er du?
            </label>
            <select
              value={driverId}
              onChange={e => setDriverId(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              {drivers.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
              {drivers.length === 0 && <option value="">Ingen chauffører oprettet</option>}
            </select>
          </div>

          {/* PIN */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Lock size={14} /> PIN-kode
            </label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="••••"
              maxLength={10}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-center text-xl tracking-widest focus:border-blue-500 focus:outline-none"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !driverId || !pin}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Logger ind…' : 'Log ind'}
          </button>
        </form>
      </div>
    </div>
  )
}
