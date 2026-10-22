import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import ProfileClient from '@/components/portal/ProfileClient'
import { getPortalLang } from '@/lib/i18n/portal/server'
import { makeT } from '@/lib/i18n/portal/lang'
import { oversaetVarenavne } from '@/lib/i18n/portal/varenavne'
import { profilDict } from '@/lib/i18n/portal/dict/profil'

export const dynamic = 'force-dynamic'

export default async function ProfilPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')
  const customerId = (session.user as any).id

  const lang = await getPortalLang()
  const t = makeT(profilDict, lang)

  const [favoritesDa, blocked] = await Promise.all([
    prisma.favorite.findMany({
      where:   { customerId },
      orderBy: { sortOrder: 'asc' },
      select:  { bcItemNumber: true, itemName: true, sortOrder: true },
    }),
    prisma.blockedItem.findMany({
      where:   { customerId },
      orderBy: { createdAt: 'asc' },
      select:  { bcItemNumber: true },
    }),
  ])
  // Favoritnavne er gemt på dansk — vis BC-oversættelsen på kundens sprog.
  const favorites = await oversaetVarenavne(favoritesDa, lang, { nr: 'bcItemNumber', navn: 'itemName' })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('minProfil')}</h1>
        <p className="mt-1 text-sm text-gray-500">{session.user.name} · {session.user.email}</p>
      </div>
      <ProfileClient
        initialFavorites={favorites}
        initialBlocked={blocked.map((b) => b.bcItemNumber)}
      />
      {/* Leveringsprofil-link */}
      <a
        href="/portal/profil/levering"
        className="flex items-center justify-between rounded-xl bg-white p-4 ring-1 ring-gray-200 hover:ring-blue-300 transition group"
      >
        <div>
          <p className="text-sm font-semibold text-gray-800">{t('leveringsoplysninger')}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t('leveringLinkTekst')}</p>
        </div>
        <span className="text-blue-500 group-hover:translate-x-1 transition-transform text-lg">→</span>
      </a>
    </div>
  )
}
