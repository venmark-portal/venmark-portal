'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, ShoppingCart, Package, FileText, MessageSquareWarning } from 'lucide-react'

const items = [
  { href: '/portal',             label: 'Hjem',        icon: Home                 },
  { href: '/portal/bestil',      label: 'Bestil',       icon: ShoppingCart         },
  { href: '/portal/ordrer',      label: 'Ordrer',       icon: Package              },
  { href: '/portal/fakturaer',   label: 'Fakturaer',    icon: FileText             },
  { href: '/portal/reklamationer', label: 'Reklamation',  icon: MessageSquareWarning },
]

export default function PortalNav() {
  const pathname = usePathname()
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white md:hidden">
      <div className="grid grid-cols-5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/portal' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
                active ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              <Icon size={21} strokeWidth={active ? 2.5 : 1.8} />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
