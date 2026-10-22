import { LangProvider } from '@/lib/i18n/portal/LangProvider'
import { getPortalLang } from '@/lib/i18n/portal/server'

export const dynamic = 'force-dynamic'

// Ingen session her — getPortalLang bruger cookien (sprogskifteren på login) eller dansk.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const lang = await getPortalLang()
  return <LangProvider lang={lang}>{children}</LangProvider>
}
