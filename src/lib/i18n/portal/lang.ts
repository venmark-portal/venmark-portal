// Kundeportalens sprog. Dansk er kilden; engelsk og tysk oversættes.
//
// Sproget vælges sådan: kundens eget valg (cookie fra DA/EN/DE-skifteren) → debitorkortets
// Sprogkode i BC → dansk. Ordbøgerne ligger pr. område i ./dict og bruges via useT (klient)
// eller getT (server) — se ./server.ts og ./LangProvider.tsx.

export const LANGS = ['da', 'en', 'de'] as const
export type Lang = typeof LANGS[number]

export const LANG_COOKIE = 'portal_lang'

export const LANG_LABELS: Record<Lang, string> = { da: 'Dansk', en: 'English', de: 'Deutsch' }

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v)
}

/** Locale til datoer, tal og beløb. */
export function localeOf(lang: Lang): string {
  return lang === 'en' ? 'en-GB' : lang === 'de' ? 'de-DE' : 'da-DK'
}

/** BC-sprogkoder pr. portalsprog — første kode er den foretrukne ved varetranslationer. */
export const BC_LANG_CODES: Record<Lang, string[]> = {
  da: ['DAN'],
  // EN/DE: prislistemotoren (tabel 50106) kender også de korte aliaser.
  en: ['ENU', 'ENG', 'EN', 'ENA', 'ENC', 'ENI', 'ENZ'],
  de: ['DEU', 'DE', 'DEA', 'DES', 'DEC'],
}

/**
 * Debitorkortets Sprogkode → portalsprog. Tom/dansk = dansk, tysk = tysk, ALT andet engelsk:
 * debitorerne har korte koder (EN, DE, GB, SE, FR, ES, NL — 2026-10-25), og en fransk eller
 * hollandsk kunde læser engelsk bedre end dansk.
 */
export function bcLangToPortal(code: string | null | undefined): Lang {
  const c = (code ?? '').trim().toUpperCase()
  if (!c || ['DAN', 'DA', 'DK', 'DANSK'].includes(c)) return 'da'
  if (BC_LANG_CODES.de.includes(c) || c.startsWith('DE') || c === 'TYSK') return 'de'
  return 'en'
}

// ── Ordbøger ────────────────────────────────────────────────────────────────
// En ordbog er { da, en, de } med de samme nøgler i alle tre — TypeScript fejler hvis en
// oversættelse mangler. Pladsholdere skrives {navn} og udfyldes af t('nøgle', { navn }).

export type Dict<K extends string> = Record<Lang, Record<K, string>>

export function defineDict<K extends string>(d: {
  da: Record<K, string>
  en: Record<K, string>
  de: Record<K, string>
}): Dict<K> {
  return d
}

export type Vars = Record<string, string | number | null | undefined>
export type TFunc<K extends string> = (key: K, vars?: Vars) => string

export function makeT<K extends string>(dict: Dict<K>, lang: Lang): TFunc<K> {
  return (key, vars) => {
    let s = dict[lang]?.[key] ?? dict.da[key] ?? key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ''))
    }
    return s
  }
}
