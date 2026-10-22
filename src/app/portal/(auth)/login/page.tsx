'use client'

import { Suspense, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import SprogSkifter from '@/components/portal/SprogSkifter'
import { useT } from '@/lib/i18n/portal/LangProvider'
import { loginDict } from '@/lib/i18n/portal/dict/login'

function LoginForm() {
  const t            = useT(loginDict)
  const router       = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl  = searchParams.get('callbackUrl') ?? '/portal'
  const passwordReset = searchParams.get('reset') === '1'

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const creds = { email: email.trim().toLowerCase(), password, redirect: false }

    const res = await signIn('customer', creds)
    if (res?.ok) {
      router.push(callbackUrl.startsWith('/portal/login') ? '/portal' : callbackUrl)
      return
    }

    const adminRes = await signIn('admin', creds)
    if (adminRes?.ok) {
      router.push('/admin')
      return
    }

    setError(t('forkertLogin'))
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          placeholder={t('emailPlaceholder')}
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
          {t('adgangskode')}
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          placeholder="••••••••"
        />
      </div>

      {passwordReset && (
        <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {t('kodeOpdateret')}
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
      >
        {loading ? t('loggerInd') : t('logInd')}
      </button>
    </form>
  )
}

export default function LoginPage() {
  const t = useT(loginDict)
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-end">
          <SprogSkifter />
        </div>
        <div className="mb-8 text-center">
          <span className="text-3xl font-bold tracking-tight">
            <span className="text-gray-900">Venmark</span>
            <span className="text-blue-600">.dk</span>
          </span>
          <p className="mt-2 text-sm text-gray-500">{t('kundeportal')}</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <h1 className="mb-6 text-xl font-semibold text-gray-900">{t('logInd')}</h1>
          <Suspense fallback={<div className="text-sm text-gray-400">{t('indlaeser')}</div>}>
            <LoginForm />
          </Suspense>
          <p className="mt-6 text-center text-sm text-gray-500">
            <Link href="/portal/forgot-password" className="text-blue-600 hover:underline">
              {t('glemtKode')}
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          © {new Date().getFullYear()} Venmark Fisk A/S
        </p>
      </div>
    </div>
  )
}
