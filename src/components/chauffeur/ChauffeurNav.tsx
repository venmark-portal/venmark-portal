'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Package, Truck } from 'lucide-react'

export default function ChauffeurNav() {
  const path = usePathname()
  const tabs = [
    { href: '/chauffeur/pak',  label: 'Pak',   icon: Package },
    { href: '/chauffeur/rute', label: 'Rute',  icon: Truck },
  ]
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white flex">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = path.startsWith(href)
        return (
          <Link key={href} href={href}
            className={`flex-1 flex flex-col items-center gap-0.5 py-3 text-xs font-medium transition-colors ${
              active ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
            }`}>
            <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
