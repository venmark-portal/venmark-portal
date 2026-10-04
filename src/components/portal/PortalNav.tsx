'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, ShoppingCart, Package, MessageSquare, FileText, Gavel } from 'lucide-react'

const items = [
  { href: '/portal',           label: 'Hjem',      icon: Home          },
  { href: '/portal/bestil',    label: 'Bestil',     icon: ShoppingCart  },
  { href: '/portal/auktioner', label: 'Auktion',    icon: Gavel         },
  { href: '/portal/ordrer',    label: 'Ordrer',     icon: Package       },
  { href: '/portal/beskeder',  label: 'Beskeder',   icon: MessageSquare },
  { href: '/portal/fakturaer', label: 'Fakturaer',  icon: FileText      },
]

// Sider hvor den fulde menu er i vejen på mobil: man taster antal, og bjælken dækker
// både varelisten og "Indsæt"-knappen i søgningen. Her vises kun en lille Hjem-knap.
const KUN_HJEM = ['/portal/bestil', '/portal/fast']

export default function PortalNav() {
  const pathname = usePathname()

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

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      {/* grid-cols-6, ikke -5: der er seks punkter, og med fem kolonner faldt Fakturaer
          ned på sin egen række og åd en hel linje af skærmen. */}
      <div className="grid grid-cols-6">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/portal' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium leading-tight transition-colors ${
                active ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              <Icon size={19} strokeWidth={active ? 2.5 : 1.8} />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
