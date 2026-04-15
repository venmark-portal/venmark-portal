'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const APP_PREFIXES = ['/portal', '/admin', '/chauffeur', '/pod']

export default function NavHeader() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  if (APP_PREFIXES.some(p => pathname.startsWith(p))) return null

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-steel-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-brand-700">
              Venmark
              <span className="text-steel-400 font-normal">.dk</span>
            </span>
          </a>

          <nav className="hidden items-center gap-6 text-sm font-medium text-steel-600 md:flex">
            <a href="/"        className="hover:text-brand-600 transition">Katalog</a>
            <a href="/om-os"   className="hover:text-brand-600 transition">Om os</a>
            <a href="/kontakt" className="hover:text-brand-600 transition">Kontakt</a>
          </nav>

          <a
            href="mailto:info@venmark.dk"
            className="hidden rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 md:block"
          >
            Kontakt os
          </a>

          <button
            onClick={() => setOpen(o => !o)}
            className="rounded-md p-2 text-steel-500 hover:bg-steel-100 md:hidden"
            aria-label="Åbn menu"
          >
            {open ? (
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="4" x2="16" y2="16" />
                <line x1="16" y1="4" x2="4" y2="16" />
              </svg>
            ) : (
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="5"  x2="17" y2="5" />
                <line x1="3" y1="10" x2="17" y2="10" />
                <line x1="3" y1="15" x2="17" y2="15" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobil-menu */}
        {open && (
          <div className="border-t border-steel-100 bg-white px-4 pb-4 md:hidden">
            <nav className="flex flex-col gap-1 pt-3 text-sm font-medium text-steel-700">
              <a href="/"        onClick={() => setOpen(false)} className="rounded-md px-3 py-2 hover:bg-steel-50">Katalog</a>
              <a href="/om-os"   onClick={() => setOpen(false)} className="rounded-md px-3 py-2 hover:bg-steel-50">Om os</a>
              <a href="/kontakt" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 hover:bg-steel-50">Kontakt</a>
              <a href="mailto:info@venmark.dk" className="mt-2 rounded-lg bg-brand-600 px-3 py-2 text-center text-white hover:bg-brand-700">
                Kontakt os
              </a>
            </nav>
          </div>
        )}
      </header>
    </>
  )
}
