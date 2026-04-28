'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

function ResetPasswordForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const token        = searchParams.get('token') ?? ''

  const [password,  setPassword]  = useState('')
  const [password2, setPassword2] = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')

  if (!token) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Ugyldigt link — token mangler. Bed om et nyt reset-link.
        </p>
        <Link
          href="/portal/forgot-password"
          className="block w-full rounded-lg bg-blue-600 py-3 text-center text-base font-semibold text-white hover:bg-blue-700"
        >
          Bed om nyt link
        </Link>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== password2) {
      setError('Adgangskoderne er ikke ens')
      return
    }
    if (password.length < 8) {
      setError('Adgangskoden skal være mindst 8 tegn')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Noget gik galt — prøv igen')
      } else {
        router.push('/portal/login?reset=1')
      }
    } catch {
      setError('Serverfejl — prøv igen')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-500">
        Vælg en ny adgangskode til din konto.
      </p>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
          Ny adgangskode
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          placeholder="Mindst 8 tegn"
        />
      </div>

      <div>
        <label htmlFor="password2" className="mb-1 block text-sm font-medium text-gray-700">
          Gentag adgangskode
        </label>
        <input
          id="password2"
          type="password"
          autoComplete="new-password"
          required
          value={password2}
          onChange={e => setPassword2(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          placeholder="••••••••"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
      >
        {loading ? 'Gemmer…' : 'Gem ny adgangskode'}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-3xl font-bold tracking-tight">
            <span className="text-gray-900">Venmark</span>
            <span className="text-blue-600">.dk</span>
          </span>
          <p className="mt-2 text-sm text-gray-500">Kundeportal</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <h1 className="mb-6 text-xl font-semibold text-gray-900">Ny adgangskode</h1>
          <Suspense fallback={<div className="text-sm text-gray-400">Indlæser…</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
