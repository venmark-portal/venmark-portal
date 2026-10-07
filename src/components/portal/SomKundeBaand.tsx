'use client'

import { signOut } from 'next-auth/react'
import { Eye } from 'lucide-react'

/**
 * Båndet der fortæller at man IKKE er sig selv.
 *
 * Det sidder øverst på hver eneste portalside så længe en admin er inde som kunden,
 * for man kan afgive rigtige ordrer herinde. Uden båndet er der intet på skærmen der
 * skiller kundens egen portal fra den man kigger med i — og en bestilling afsendt i
 * den tro at man "bare kiggede" er en rigtig ordre på en rigtig kunde.
 *
 * Farven er bevidst anderledes end alt andet i portalen (ravgul/sort), så det ikke
 * læses som endnu et banner.
 */
export default function SomKundeBaand({ kunde, admin }: { kunde: string; admin: string }) {
  return (
    <div className="sticky top-0 z-[60] flex items-center gap-2 bg-amber-400 px-4 py-1.5 text-[13px] font-medium text-amber-950">
      <Eye size={15} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        Du ser portalen som <strong>{kunde}</strong>
        <span className="hidden sm:inline"> · åbnet af {admin}</span>
      </span>
      <button
        onClick={() => signOut({ callbackUrl: '/admin/kunder' })}
        className="shrink-0 whitespace-nowrap rounded-md bg-amber-950 px-2.5 py-1 text-xs font-semibold text-amber-50 active:scale-95"
      >
        Afslut
      </button>
    </div>
  )
}
