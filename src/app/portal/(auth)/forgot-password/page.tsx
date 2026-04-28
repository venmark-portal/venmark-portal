'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email,     setEmail]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error,     setError]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Noget gik galt — prøv igen')
      } else {
        setSubmitted(true)
      }
    } catch {
      setError('Serverfejl — prøv igen')
    } finally {
      setLoading(false)
    }
  }

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
          <h1 className="mb-2 text-xl font-semibold text-gray-900">Glemt adgangskode?</h1>

          {submitted ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Hvis der findes en konto med <strong>{email}</strong>, er der sendt en email med et link til at nulstille adgangskoden.
              </p>
              <p className="text-sm text-gray-500">
                Tjek evt. din spam-mappe. Linket er gyldigt i 1 time.
              </p>
              <Link
                href="/portal/login"
                className="mt-2 block w-full rounded-lg border border-gray-300 py-2.5 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Tilbage til login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-gray-500">
                Indtast din email, så sender vi et link til at vælge en ny adgangskode.
              </p>

              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="din@email.dk"
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
                {loading ? 'Sender…' : 'Send reset-link'}
              </button>

              <Link
                href="/portal/login"
                className="block text-center text-sm text-gray-500 hover:text-gray-700"
              >
                ← Tilbage til login
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
