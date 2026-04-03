import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import SessionProvider from '@/components/portal/SessionProvider'

export const metadata: Metadata = {
  title: 'Chauffør | Venmark',
}

export default async function ChauffeurLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  return (
    <SessionProvider session={session}>
      <div className="min-h-screen bg-gray-50">
        {children}
      </div>
    </SessionProvider>
  )
}
