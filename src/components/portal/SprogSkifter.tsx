'use client'

// DA / EN / DE i portalens menu. Valget gemmes i en cookie og vinder over debitorkortets
// sprogkode; router.refresh() henter server-teksterne igen på det nye sprog.

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { LANGS, LANG_LABELS, type Lang } from '@/lib/i18n/portal/lang'
import { gemSprogValg, useLang } from '@/lib/i18n/portal/LangProvider'

export default function SprogSkifter({ className = '' }: { className?: string }) {
  const lang = useLang()
  const router = useRouter()
  const [venter, startTransition] = useTransition()

  const vaelg = (l: Lang) => {
    if (l === lang) return
    gemSprogValg(l)
    startTransition(() => router.refresh())
  }

  return (
    <div
      role="group"
      aria-label="Sprog / Language / Sprache"
      className={`inline-flex overflow-hidden rounded-lg border border-gray-300 text-xs font-semibold ${venter ? 'opacity-60' : ''} ${className}`}
    >
      {LANGS.map(l => (
        <button
          key={l}
          type="button"
          onClick={() => vaelg(l)}
          title={LANG_LABELS[l]}
          aria-pressed={l === lang}
          className={`px-2.5 py-1.5 uppercase transition-colors ${
            l === lang ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
