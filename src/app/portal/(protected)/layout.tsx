import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import PortalNav from '@/components/portal/PortalNav'
import VersionVagt from '@/components/portal/VersionVagt'
import SomKundeBaand from '@/components/portal/SomKundeBaand'
import SessionProvider from '@/components/portal/SessionProvider'
import CustomerSwitcher from '@/components/portal/CustomerSwitcher'
import TicketNotifier from '@/components/portal/TicketNotifier'
import PushSubscribeButton from '@/components/portal/PushSubscribeButton'
import SprogSkifter from '@/components/portal/SprogSkifter'
import { LangProvider } from '@/lib/i18n/portal/LangProvider'
import { getPortalLang } from '@/lib/i18n/portal/server'
import { makeT } from '@/lib/i18n/portal/lang'
import { navDict } from '@/lib/i18n/portal/dict/nav'

export const metadata: Metadata = {
  title: 'Venmark Portal',
  manifest: '/portal-manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Venmark',
  },
}

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/portal/login')
  }

  const lang = await getPortalLang()
  const t = makeT(navDict, lang)

  // Hent portal-udseende-indstillinger via rå SQL (undgår Prisma generate-krav)
  const defaultSettings = {
    bgColor:        '#eff6ff',
    bannerEnabled:  false,
    bannerText:     '',
    bannerBgColor:  '#1e40af',
    bannerTextColor:'#ffffff',
  }
  let settings = defaultSettings
  try {
    await prisma.$executeRaw`
      INSERT INTO "PortalSettings"
        (id, "bgColor", "bannerEnabled", "bannerText", "bannerBgColor", "bannerTextColor", "updatedAt")
      VALUES ('default', '#eff6ff', false, '', '#1e40af', '#ffffff', NOW())
      ON CONFLICT (id) DO NOTHING
    `
    const rows = await prisma.$queryRaw<any[]>`
      SELECT "bgColor", "bannerEnabled", "bannerText", "bannerBgColor", "bannerTextColor"
      FROM "PortalSettings" WHERE id = 'default'
    `
    if (rows.length > 0) {
      const r = rows[0]
      settings = {
        bgColor:        r.bgColor,
        bannerEnabled:  Boolean(r.bannerEnabled),
        bannerText:     r.bannerText ?? '',
        bannerBgColor:  r.bannerBgColor,
        bannerTextColor:r.bannerTextColor,
      }
    }
  } catch {
    // Brug defaults
  }

  return (
    <SessionProvider session={session}>
    <LangProvider lang={lang}>
      <div lang={lang} className="flex min-h-screen flex-col" style={{ backgroundColor: settings.bgColor }}>

        {/* Admin kigger med som kunden — skal kunne ses på HVER side. */}
        {(session.user as any)?.impersonatedBy && (
          <SomKundeBaand
            kunde={session.user?.name ?? t('kunden')}
            admin={(session.user as any).impersonatedBy}
          />
        )}

        {/* Desktop-topbar */}
        <header className="hidden border-b border-white/60 bg-white/80 backdrop-blur-sm md:block sticky top-0 z-30 shadow-sm">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <span className="text-xl font-bold">
              <span className="text-gray-900">Venmark</span>
              <span className="text-blue-600">.dk</span>
            </span>
            <nav className="flex items-center gap-6 text-sm font-medium text-gray-600">
              <a href="/portal"                className="hover:text-gray-900 transition-colors">{t('oversigt')}</a>
              <a href="/portal/bestil"         className="hover:text-gray-900 transition-colors">{t('bestil')}</a>
              <a href="/portal/ordrer"         className="hover:text-gray-900 transition-colors">{t('ordrer')}</a>
              <a href="/portal/fakturaer"      className="hover:text-gray-900 transition-colors">{t('fakturaer')}</a>
              <a href="/portal/beskeder"       className="hover:text-gray-900 transition-colors">{t('beskeder')}</a>
              <a href="/portal/reklamationer"  className="hover:text-gray-900 transition-colors">{t('reklamationer')}</a>
              <a href="/portal/profil"         className="hover:text-gray-900 transition-colors">{t('profil')}</a>
              <a href="/portal/hjaelp"         className="hover:text-gray-900 transition-colors">{t('hjaelp')}</a>
            </nav>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{session.user?.name}</span>
              <SprogSkifter />
              <a
                href="/api/auth/signout"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {t('logUd')}
              </a>
            </div>
          </div>
        </header>

        {/* Mobil-header */}
        <header className="border-b border-white/60 bg-white/80 backdrop-blur-sm md:hidden sticky top-0 z-30 shadow-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-lg font-bold">
              <span className="text-gray-900">Venmark</span>
              <span className="text-blue-600">.dk</span>
            </span>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm text-gray-500">{session.user?.name}</span>
              <SprogSkifter />
            </div>
          </div>
        </header>

        {/* Kunde-vælger — kun synlig for kunder med flere butikker */}
        <CustomerSwitcher />

        {/* Banner (vises på alle sider hvis aktiveret) */}
        {settings.bannerEnabled && settings.bannerText && (
          <div
            className="w-full px-4 py-2.5 text-center text-sm font-medium shadow-sm"
            style={{
              backgroundColor: settings.bannerBgColor,
              color:           settings.bannerTextColor,
            }}
          >
            {settings.bannerText}
          </div>
        )}

        {/* Sideindhold */}
        <main className="flex-1 pb-20 md:pb-0">
          <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
            {children}
          </div>
        </main>

        <TicketNotifier />
        <PushSubscribeButton />
        <VersionVagt />
        {/* Mobil-bundnavigation */}
        <PortalNav />
      </div>
    </LangProvider>
    </SessionProvider>
  )
}
