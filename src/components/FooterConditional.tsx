'use client'

import { usePathname } from 'next/navigation'

const APP_PREFIXES = ['/portal', '/admin', '/chauffeur', '/pod']

export default function FooterConditional() {
  const pathname = usePathname()

  if (APP_PREFIXES.some(p => pathname.startsWith(p))) return null

  return (
    <footer className="border-t border-steel-200 bg-white mt-16">
      <div className="mx-auto max-w-screen-xl px-4 py-8 text-sm text-steel-500">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <p>© {new Date().getFullYear()} Venmark.dk · Alle rettigheder forbeholdes</p>
          <div className="flex gap-4">
            <a href="/kontakt"           className="hover:text-brand-600 transition">Kontakt</a>
            <a href="/privatlivspolitik" className="hover:text-brand-600 transition">Privatlivspolitik</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
