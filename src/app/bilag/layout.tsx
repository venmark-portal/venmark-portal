import type { Metadata, Viewport } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import SessionProvider from '@/components/portal/SessionProvider'
import RolleSkift from '@/components/RolleSkift'

export const metadata: Metadata = { title: 'Bilag | Venmark' }
export const dynamic = 'force-dynamic'
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

// Udlæg/bilag: for ALLE medarbejdere (uanset rolle) hvis kreditoren i BC har "Bilag tilladt".
// Selve adgangen tjekkes i API'et (lib/udlaeg.ts) — her kræves kun et login.
export default async function BilagLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/portal/login?callbackUrl=/bilag')
  return (
    <SessionProvider session={session}>
      <div className="min-h-screen bg-gray-100">
        <RolleSkift flydende />
        {children}
      </div>
    </SessionProvider>
  )
}
