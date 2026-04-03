import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import PortalNav from '@/components/portal/PortalNav'
import SessionProvider from '@/components/portal/SessionProvider'
import TicketNotifier from '@/components/portal/TicketNotifier'

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/portal/login')
  }

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
      <div className="flex min-h-screen flex-col" style={{ backgroundColor: settings.bgColor }}>

        {/* Desktop-topbar */}
        <header className="hidden border-b border-white/60 bg-white/80 backdrop-blur-sm md:block sticky top-0 z-30 shadow-sm">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <span className="text-xl font-bold">
              <span className="text-gray-900">Venmark</span>
              <span className="text-blue-600">.dk</span>
            </span>
            <nav className="flex items-center gap-6 text-sm font-medium text-gray-600">
              <a href="/portal"                className="hover:text-gray-900 transition-colors">Oversigt</a>
              <a href="/portal/bestil"         className="hover:text-gray-900 transition-colors">Bestil</a>
              <a href="/portal/ordrer"         className="hover:text-gray-900 transition-colors">Ordrer</a>
              <a href="/portal/fakturaer"      className="hover:text-gray-900 transition-colors">Fakturaer</a>
              <a href="/portal/reklamationer"  className="hover:text-gray-900 transition-colors">Reklamationer</a>
              <a href="/portal/profil"         className="hover:text-gray-900 transition-colors">Profil</a>
            </nav>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{session.user?.name}</span>
              <a
                href="/api/auth/signout"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Log ud
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
            <span className="text-sm text-gray-500">{session.user?.name}</span>
          </div>
        </header>

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
        {/* Mobil-bundnavigation */}
        <PortalNav />
      </div>
    </SessionProvider>
  )
}
