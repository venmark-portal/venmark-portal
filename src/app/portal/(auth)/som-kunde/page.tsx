'use client'

// Indløser billetten fra /admin/kunde-som/<kundenr> og lander på portalens forside
// som kunden. Siden er åben i middlewaren — den skal pr. definition kunne nås uden
// at være logget ind, for det er netop den der giver adgangen.
//
// Billetten indløses her i browseren frem for server-side, fordi NextAuth skal sætte
// sessions-cookien gennem sit eget login-kald. Den er engangs, så et genbesøg med
// samme adresse (fx tilbage-knappen) fejler — og det er meningen.

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useT } from '@/lib/i18n/portal/LangProvider'
import { loginDict } from '@/lib/i18n/portal/dict/login'

// Suspense omkring useSearchParams — ellers kan siden ikke forrenderes.
export default function SomKundePage() {
  return (
    <Suspense>
      <SomKunde />
    </Suspense>
  )
}

function SomKunde() {
  const t = useT(loginDict)
  const params = useSearchParams()
  const [fejl, setFejl] = useState<string | null>(null)

  useEffect(() => {
    const token = params.get('token')
    if (!token) { setFejl(t('billetMangler')); return }
    signIn('impersonate', { token, redirect: false })
      .then(res => {
        if (res?.ok) window.location.href = '/portal'
        else setFejl(t('billetBrugt'))
      })
      .catch(() => setFejl(t('ingenForbindelse')))
  }, [params])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-gray-200">
        {fejl ? (
          <>
            <p className="text-sm font-semibold text-red-700">{t('somKundeFejl')}</p>
            <p className="mt-2 text-sm text-gray-600">{fejl}</p>
            <a href="/admin/kunder" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline">
              {t('tilKundelisten')}
            </a>
          </>
        ) : (
          <p className="text-sm text-gray-500">{t('aabnerSomKunde')}</p>
        )}
      </div>
    </div>
  )
}
