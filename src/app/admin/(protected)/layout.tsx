import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import SessionProvider from '@/components/portal/SessionProvider'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session || (session.user as any)?.role !== 'admin') {
    redirect('/admin/login')
  }

  return (
    <SessionProvider session={session}>
      <div className="min-h-screen bg-gray-50">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xl font-bold">
                  <span className="text-gray-900">Venmark</span>
                  <span className="text-blue-600">.dk</span>
                </span>
                <span className="rounded-md bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                  ADMIN
                </span>
              </div>
              <nav className="flex items-center gap-1 text-sm font-medium text-gray-600 flex-wrap">
                <a href="/admin"               className="rounded px-2 py-1 hover:bg-gray-100 hover:text-gray-900">Godkendelse</a>
                <a href="/admin/kunder"        className="rounded px-2 py-1 hover:bg-gray-100 hover:text-gray-900">Kunder</a>
                <a href="/admin/anbefalinger"  className="rounded px-2 py-1 hover:bg-gray-100 hover:text-gray-900">Anbefalinger</a>
                <a href="/admin/reklamationer" className="rounded px-2 py-1 hover:bg-gray-100 hover:text-gray-900">Reklamationer</a>
                <a href="/admin/udseende"      className="rounded px-2 py-1 hover:bg-gray-100 hover:text-gray-900">Udseende</a>
                <span className="mx-1 text-gray-300">|</span>
                <a href="/admin/leveringer"       className="rounded px-2 py-1 bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100">Leveringer</a>
                <a href="/admin/leveringshistorik" className="rounded px-2 py-1 hover:bg-gray-100 hover:text-gray-900">Historik</a>
                <a href="/admin/chauffoerer"      className="rounded px-2 py-1 hover:bg-gray-100 hover:text-gray-900">Chauffører</a>
                <a href="/admin/leveringskoder"   className="rounded px-2 py-1 hover:bg-gray-100 hover:text-gray-900">Leveringskoder</a>
              </nav>
              <a
                href="/api/auth/signout"
                className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Log ud
              </a>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 md:px-6">
          {children}
        </main>
      </div>
    </SessionProvider>
  )
}
