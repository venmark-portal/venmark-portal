'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/portal/LangProvider'
import { loginDict, loginApiFejl } from '@/lib/i18n/portal/dict/login'

export default function ForgotPasswordPage() {
  const t = useT(loginDict)
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
        setError(loginApiFejl[data.error] ? t(loginApiFejl[data.error]) : (data.error ?? t('noget')))
      } else {
        setSubmitted(true)
      }
    } catch {
      setError(t('serverfejl'))
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
          <p className="mt-2 text-sm text-gray-500">{t('kundeportal')}</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <h1 className="mb-2 text-xl font-semibold text-gray-900">{t('glemtKode')}</h1>

          {submitted ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {t('sendtFoer')}<strong>{email}</strong>{t('sendtEfter')}
              </p>
              <p className="text-sm text-gray-500">
                {t('tjekSpam')}
              </p>
              <Link
                href="/portal/login"
                className="mt-2 block w-full rounded-lg border border-gray-300 py-2.5 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('tilbageLogin')}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-gray-500">
                {t('indtastEmail')}
              </p>

              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                  {t('email')}
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder={t('emailPlaceholder')}
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
                {loading ? t('sender') : t('sendLink')}
              </button>

              <Link
                href="/portal/login"
                className="block text-center text-sm text-gray-500 hover:text-gray-700"
              >
                ← {t('tilbageLogin')}
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
