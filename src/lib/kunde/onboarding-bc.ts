import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'

/**
 * Kunde-onboarding læser/skriver mod BC's customerOnboardings-API (page 50462,
 * venmark/portal/v1.0). BC ejer record'en (oprettet ved "Send link" med token) —
 * portalen læser den på token og PATCH'er de udfyldte felter + status tilbage.
 */

export interface OnboardingRecord {
  id: string
  token: string
  bcCustomerNo: string
  variant: string          // 'Standard' | 'Leverandoerservice'
  guarantyRequired?: boolean // selvskyldnerkaution — uafhængig af variant (mangler før BC-sync)
  languageCode: string     // 'da' | 'en'
  status: string           // 'IkkeSendt' | 'Sendt' | 'Afventer' | 'Godkendt' | ...
  [key: string]: any
}

export async function getOnboardingByToken(token: string): Promise<OnboardingRecord | null> {
  const at = await getAccessToken()
  const base = bcPortalBaseUrl()
  const res = await fetch(
    `${base}/customerOnboardings?$filter=token eq '${encodeURIComponent(token)}'`,
    { headers: { Authorization: `Bearer ${at}`, Accept: 'application/json' }, cache: 'no-store' }
  )
  if (!res.ok) throw new Error(`BC onboarding GET fejl ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return (data.value && data.value[0]) || null
}

export async function patchOnboarding(id: string, patch: Record<string, any>): Promise<void> {
  const at = await getAccessToken()
  const base = bcPortalBaseUrl()
  const res = await fetch(`${base}/customerOnboardings(${id})`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${at}`,
      'Content-Type': 'application/json',
      'If-Match': '*',
    },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`BC onboarding PATCH fejl ${res.status}: ${await res.text()}`)
}
