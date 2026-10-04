'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home, ShoppingCart, Package, MessageSquare, FileText, Gavel,
  MessageSquareWarning, User, HelpCircle, LogOut, MoreHorizontal, X,
} from 'lucide-react'

// Bundbjælken har plads til fem punkter på en telefon. Desktop-topbaren har otte, og de tre
// sidste (Reklamationer, Profil, Hjælp) fandtes slet ikke på mobil — man kunne ikke engang
// logge ud. De ligger nu under "Mere" i stedet for at blive presset ned i en ekstra række.
const BJAELKE = [
  { href: '/portal',          label: 'Hjem',     icon: Home          },
  { href: '/portal/bestil',   label: 'Bestil',   icon: ShoppingCart  },
  { href: '/portal/ordrer',   label: 'Ordrer',   icon: Package       },
  { href: '/portal/beskeder', label: 'Beskeder', icon: MessageSquare },
]

const MERE = [
  { href: '/portal/fakturaer',     label: 'Fakturaer',     icon: FileText            },
  { href: '/portal/auktioner',     label: 'Auktioner',     icon: Gavel               },
  { href: '/portal/reklamationer', label: 'Reklamationer', icon: MessageSquareWarning },
  { href: '/portal/profil',        label: 'Profil',        icon: User                },
  { href: '/portal/hjaelp',        label: 'Hjælp',         icon: HelpCircle          },
]

// Sider hvor den fulde menu er i vejen på mobil: man taster antal, og bjælken dækker
// både varelisten og "Indsæt"-knappen i søgningen. Her vises kun en lille Hjem-knap.
const KUN_HJEM = ['/portal/bestil', '/portal/fast']

export default function PortalNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // Luk arket når man er navigeret videre — ellers står det åbent oven på den nye side.
  useEffect(() => { setOpen(false) }, [pathname])

  if (KUN_HJEM.some(p => pathname.startsWith(p))) {
    return (
      <Link
        href="/portal"
        aria-label="Hjem"
        className="fixed bottom-3 left-3 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-500 shadow-lg backdrop-blur transition active:scale-95 md:hidden"
      >
        <Home size={20} />
      </Link>
    )
  }

  const erAktiv = (href: string) =>
    pathname === href || (href !== '/portal' && pathname.startsWith(href))
  const mereAktiv = MERE.some(m => erAktiv(m.href))

  return (
    <>
      {/* "Mere"-ark */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:hidden" onClick={() => setOpen(false)}>
          <div
            className="w-full rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <span className="text-sm font-semibold text-gray-900">Mere</span>
              <button onClick={() => setOpen(false)} className="rounded-full p-1 hover:bg-gray-100" aria-label="Luk">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            <div className="divide-y divide-gray-50">
              {MERE.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 px-5 py-3.5 text-sm font-medium transition-colors active:bg-gray-50 ${
                    erAktiv(href) ? 'text-blue-600' : 'text-gray-700'
                  }`}
                >
                  <Icon size={19} className="shrink-0" />
                  {label}
                </Link>
              ))}

              {/* Mobil-headeren har ingen "Log ud" — uden denne kunne man slet ikke logge
                  ud fra en telefon. */}
              <a
                href="/api/auth/signout"
                className="flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-gray-500 transition-colors active:bg-gray-50"
              >
                <LogOut size={19} className="shrink-0" />
                Log ud
              </a>
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid grid-cols-5">
          {BJAELKE.map(({ href, label, icon: Icon }) => {
            const active = erAktiv(href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium leading-tight transition-colors ${
                  active ? 'text-blue-600' : 'text-gray-500'
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                {label}
              </Link>
            )
          })}

          <button
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium leading-tight transition-colors ${
              mereAktiv || open ? 'text-blue-600' : 'text-gray-500'
            }`}
          >
            <MoreHorizontal size={20} strokeWidth={mereAktiv || open ? 2.5 : 1.8} />
            Mere
          </button>
        </div>
      </nav>
    </>
  )
}
