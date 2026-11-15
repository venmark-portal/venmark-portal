import type { Metadata, Viewport } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import SessionProvider from '@/components/portal/SessionProvider'
import RolleSkift from '@/components/RolleSkift'
import NyVersion from '@/components/lager/NyVersion'

export const metadata: Metadata = {
  title: 'Lager | Venmark',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Lager' },
}

// Siderne må ALDRIG serveres fra en cache. En telefon der holder fast i en gammel
// udgave er umulig at fejlsøge: man tester noget der ikke findes mere og tror fejlen
// stadig er der. Alt her er alligevel personligt (login, lokation), så der er intet
// at vinde ved at cache det.
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Terminalen skal ikke kunne zoome ved et uheld midt i en optælling.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default async function LagerLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  return (
    <SessionProvider session={session}>
      <div className="min-h-screen bg-gray-100">
        <NyVersion />
        <RolleSkift flydende />
        {children}
      </div>
    </SessionProvider>
  )
}
