'use client'

// Rolleskift for medarbejdere med flere roller (kunde, lager/pakker, admin, chauffør …).
// Vises kun når den indloggede er en medarbejder med mindst to roller. Skiftet sker på
// serveren (lib/auth.ts), og man lander på rollens startside.

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { skiftRolle, somKlientRolle, ROLLE_START, type KlientRolle } from '@/lib/rolleSkiftKlient'

const NAVN: Record<KlientRolle, string> = {
  kunde: 'Kunde', lager: 'Lager/pakker', admin: 'Admin', chauffoer: 'Chauffør',
}

export default function RolleSkift({ flydende = false }: { flydende?: boolean }) {
  const { data } = useSession()
  const m = (data?.user as any)?.medarbejder as { navn: string; roller: KlientRolle[] } | null | undefined
  const nu = somKlientRolle((data?.user as any)?.role)
  const [aaben, setAaben] = useState(false)
  const [travl, setTravl] = useState<KlientRolle | null>(null)
  const [fejl, setFejl] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aaben) return
    const luk = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAaben(false) }
    document.addEventListener('mousedown', luk)
    return () => document.removeEventListener('mousedown', luk)
  }, [aaben])

  if (!m || (m.roller?.length ?? 0) < 2) return null

  async function vaelg(r: KlientRolle) {
    if (r === nu) { setAaben(false); return }
    setTravl(r); setFejl(false)
    const ny = await skiftRolle(r).catch(() => null)
    if (somKlientRolle(ny ?? undefined) === r) window.location.href = ROLLE_START[r]
    else { setTravl(null); setFejl(true) }
  }

  return (
    <div ref={ref} className={flydende ? 'fixed right-2 top-2 z-[60] print:hidden' : 'relative print:hidden'}>
      <button type="button" onClick={() => setAaben(v => !v)} aria-haspopup="menu" aria-expanded={aaben}
        className="flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50">
        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
        {nu ? NAVN[nu] : 'Rolle'}
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-gray-400" aria-hidden="true">
          <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" />
        </svg>
      </button>
      {aaben && (
        <div role="menu" className="absolute right-0 z-[61] mt-1 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg">
          <p className="px-3 pb-1 pt-1.5 text-[11px] uppercase tracking-wide text-gray-400">{m.navn} · skift rolle</p>
          {m.roller.map(r => (
            <button key={r} type="button" role="menuitem" disabled={!!travl} onClick={() => vaelg(r)}
              className={'flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-60 ' +
                (r === nu ? 'font-semibold text-blue-700' : 'text-gray-700')}>
              {NAVN[r]}
              {r === nu && <span className="text-xs">✓</span>}
              {travl === r && <span className="text-xs text-gray-400">…</span>}
            </button>
          ))}
          {fejl && <p className="px-3 py-1.5 text-xs text-red-600">Rollen kunne ikke vælges. Spørg kontoret.</p>}
        </div>
      )}
    </div>
  )
}
