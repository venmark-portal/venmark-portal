'use client'

// Portalsprog i klient-komponenter. Layoutet finder sproget på serveren og lægger det her,
// så klienten aldrig gætter selv (ingen blink fra dansk til tysk).

import { createContext, useContext, useMemo } from 'react'
import { LANG_COOKIE, localeOf, makeT, type Dict, type Lang, type TFunc } from './lang'

const LangContext = createContext<Lang>('da')

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>
}

export function useLang(): Lang {
  return useContext(LangContext)
}

/** Locale til toLocaleDateString / Intl.NumberFormat. */
export function useLocale(): string {
  return localeOf(useLang())
}

/** `const t = useT(bestilDict)` → `t('send')`, `t('linjer', { n: 3 })`. */
export function useT<K extends string>(dict: Dict<K>): TFunc<K> {
  const lang = useLang()
  return useMemo(() => makeT(dict, lang), [dict, lang])
}

/** Gemmer kundens valg i et år; siden genindlæses af kalderen (router.refresh). */
export function gemSprogValg(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
}
