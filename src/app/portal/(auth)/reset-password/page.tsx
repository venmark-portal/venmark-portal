'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useT } from '@/lib/i18n/portal/LangProvider'
import { loginDict, loginApiFejl } from '@/lib/i18n/portal/dict/login'

function ResetPasswordForm() {
  const t            = useT(loginDict)
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
          {t('ugyldigtLink')}
        </p>
        <Link
          href="/portal/forgot-password"
          className="block w-full rounded-lg bg-blue-600 py-3 text-center text-base font-semibold text-white hover:bg-blue-700"
        >
          {t('nytLink')}
        </Link>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== password2) {
      setError(t('ikkeEns'))
      return
    }
    if (password.length < 8) {
      setError(t('min8'))
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
        setError(loginApiFejl[data.error] ? t(loginApiFejl[data.error]) : (data.error ?? t('noget')))
      } else {
        router.push('/portal/login?reset=1')
      }
    } catch {
      setError(t('serverfejl'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('vaelgNy')}
      </p>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
          {t('nyKode')}
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
          placeholder={t('min8Placeholder')}
        />
      </div>

      <div>
        <label htmlFor="password2" className="mb-1 block text-sm font-medium text-gray-700">
          {t('gentagKode')}
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
        {loading ? t('gemmer') : t('gemNyKode')}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  const t = useT(loginDict)
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
          <h1 className="mb-6 text-xl font-semibold text-gray-900">{t('nyKode')}</h1>
          <Suspense fallback={<div className="text-sm text-gray-400">{t('indlaeser')}</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
