import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Venmark.dk — Industrielt varekatalog',
  description:
    'Professionelt varekatalog med direkte kobling til Business Central. Find varer, priser og lagerstatus.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="da">
      <body className="min-h-screen flex flex-col">
        {/* ── Top-navigation ── */}
        <header className="sticky top-0 z-50 border-b border-steel-200 bg-white shadow-sm">
          <div className="mx-auto flex max-w-screen-xl items-center justify-between px-4 py-3">
            {/* Logo */}
            <a href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-brand-700">
                Venmark
                <span className="text-steel-400 font-normal">.dk</span>
              </span>
            </a>

            {/* Navigation */}
            <nav className="hidden items-center gap-6 text-sm font-medium text-steel-600 md:flex">
              <a href="/"        className="hover:text-brand-600 transition">Katalog</a>
              <a href="/om-os"   className="hover:text-brand-600 transition">Om os</a>
              <a href="/kontakt" className="hover:text-brand-600 transition">Kontakt</a>
            </nav>

            {/* Kontakt-knap */}
            <a
              href="mailto:info@venmark.dk"
              className="
                hidden rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white
                shadow-sm transition hover:bg-brand-700 md:block
              "
            >
              Kontakt os
            </a>

            {/* Mobil-menu knap (simpel) */}
            <button className="rounded-md p-2 text-steel-500 hover:bg-steel-100 md:hidden">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="5"  x2="17" y2="5" />
                <line x1="3" y1="10" x2="17" y2="10" />
                <line x1="3" y1="15" x2="17" y2="15" />
              </svg>
            </button>
          </div>
        </header>

        {/* ── Indhold ── */}
        <main className="flex-1">
          {children}
        </main>

        {/* ── Footer ── */}
        <footer className="border-t border-steel-200 bg-white mt-16">
          <div className="mx-auto max-w-screen-xl px-4 py-8 text-sm text-steel-500">
            <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
              <p>© {new Date().getFullYear()} Venmark.dk · Alle rettigheder forbeholdes</p>
              <div className="flex gap-4">
                <a href="/kontakt"         className="hover:text-brand-600 transition">Kontakt</a>
                <a href="/privatlivspolitik" className="hover:text-brand-600 transition">Privatlivspolitik</a>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}
