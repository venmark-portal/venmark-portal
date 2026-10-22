// Portalsprog på serveren (server components og API-ruter).

import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'
import { getActiveCustomerNo } from '@/lib/activeCustomer'
import { LANG_COOKIE, isLang, bcLangToPortal, makeT, type Dict, type Lang, type TFunc } from './lang'

// Debitorens Sprogkode skifter sjældent — én BC-forespørgsel pr. kunde pr. 6 timer.
const SPROG_TTL_MS = 6 * 60 * 60 * 1000
const sprogCache = new Map<string, { lang: Lang; t: number }>()

async function bcSprogForKunde(customerNo: string): Promise<Lang> {
  const hit = sprogCache.get(customerNo)
  if (hit && Date.now() - hit.t < SPROG_TTL_MS) return hit.lang
  let lang: Lang = 'da'
  try {
    const token = await getAccessToken()
    const filter = encodeURIComponent(`number eq '${customerNo.replace(/'/g, "''")}'`)
    const res = await fetch(`${bcPortalBaseUrl()}/customerGroups?$filter=${filter}&$select=number,languageCode`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (res.ok) {
      const row = (await res.json()).value?.[0]
      lang = bcLangToPortal(row?.languageCode)
    } else {
      // 400 = feltet findes ikke endnu (BC før v29.0.147.453) — dansk indtil Force Sync.
      console.warn(`[sprog] customerGroups ${res.status} for ${customerNo}`)
    }
  } catch (e) {
    console.warn('[sprog] BC-opslag fejlede:', e instanceof Error ? e.message : e)
  }
  sprogCache.set(customerNo, { lang, t: Date.now() })
  return lang
}

/** Kundens valgte sprog (cookie) → debitorkortets sprogkode → dansk. */
export async function getPortalLang(): Promise<Lang> {
  const valgt = cookies().get(LANG_COOKIE)?.value
  if (isLang(valgt)) return valgt
  try {
    const session = await getServerSession(authOptions)
    const customerNo = session ? getActiveCustomerNo(session) : ''
    if (customerNo) return await bcSprogForKunde(customerNo)
  } catch { /* dansk */ }
  return 'da'
}

/** Oversætter til en server component: `const t = await getT(dashboardDict)`. */
export async function getT<K extends string>(dict: Dict<K>, lang?: Lang): Promise<TFunc<K>> {
  return makeT(dict, lang ?? (await getPortalLang()))
}
