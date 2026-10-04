'use client'

import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * Opdager at der er deployet en ny udgave mens kunden havde portalen åben.
 *
 * Portalen ligger på mange telefoner som app fra hjemmeskærmen. Sådan en bliver aldrig
 * genindlæst — den kan køre dage gammel JavaScript op mod et nyt API. Det er ikke et
 * teoretisk problem: 2026-10-04 svarede serveren med et nyt felt i en fejlbesked, og den
 * gamle kode kunne ikke læse det og viste hele JSON-svaret til kunden i stedet.
 *
 * Vi gemmer serverens byggenummer ved første visning og sammenligner når fanen bliver
 * synlig igen. Er det et andet, er der deployet imens. Vi genindlæser IKKE af os selv —
 * kunden kan stå midt i en bestilling, og en uvarslet genindlæsning ville smide kurven
 * på gulvet. Hun får en knap i stedet.
 */
export default function VersionVagt() {
  const minVersion = useRef<string | null>(null)
  const [nyVersion, setNyVersion] = useState(false)

  useEffect(() => {
    let stoppet = false

    async function tjek() {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const { build } = await res.json()
        if (stoppet || typeof build !== 'string' || !build) return
        if (minVersion.current === null) { minVersion.current = build; return }
        if (build !== minVersion.current) setNyVersion(true)
      } catch { /* offline eller midt i et deploy — prøv igen næste gang */ }
    }

    tjek()
    const vedSynlig = () => { if (document.visibilityState === 'visible') tjek() }
    document.addEventListener('visibilitychange', vedSynlig)
    const ur = setInterval(tjek, 15 * 60 * 1000)
    return () => { stoppet = true; document.removeEventListener('visibilitychange', vedSynlig); clearInterval(ur) }
  }, [])

  if (!nyVersion) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] border-t border-amber-200 bg-amber-50 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <RefreshCw size={18} className="shrink-0 text-amber-600" />
        <span className="min-w-0 flex-1 text-sm text-amber-900">
          Der er kommet en ny udgave af portalen.
        </span>
        <button
          onClick={() => window.location.reload()}
          className="shrink-0 whitespace-nowrap rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white active:scale-95"
        >
          Opdater
        </button>
      </div>
    </div>
  )
}
