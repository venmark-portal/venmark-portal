'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * Holder øje med om serveren har fået en ny udgave af appen.
 *
 * En telefon eller en håndterminal bliver ved med at vise den side den allerede har
 * hentet — man står og tester en version der ikke findes mere, og tror fejlen stadig
 * er der. Vi spørger serveren hvad den kører, og skifter nummeret, kommer der et bånd
 * man kan trykke på. Opdateringen rydder både browserens cache og en eventuel
 * service worker, for ellers kommer den gamle side igen.
 */
export default function NyVersion() {
  const [min, setMin] = useState('')
  const [ny, setNy] = useState('')

  const tjek = useCallback(async () => {
    try {
      const r = await fetch('/api/lager/version', { cache: 'no-store' })
      if (!r.ok) return
      const { version } = await r.json()
      if (!version) return
      setMin(m => {
        if (!m) return version
        if (m !== version) setNy(version)
        return m
      })
    } catch {
      /* offline — prøv igen næste gang */
    }
  }, [])

  useEffect(() => {
    tjek()
    // Ved opstart, hvert 5. minut, og hver gang skærmen kommer frem igen.
    const i = window.setInterval(tjek, 5 * 60 * 1000)
    const synlig = () => { if (document.visibilityState === 'visible') tjek() }
    document.addEventListener('visibilitychange', synlig)
    return () => {
      window.clearInterval(i)
      document.removeEventListener('visibilitychange', synlig)
    }
  }, [tjek])

  async function opdater() {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.()
      await Promise.all((regs ?? []).map(r => r.unregister()))
    } catch { /* ingen service worker */ }
    try {
      const n = await caches?.keys?.()
      await Promise.all((n ?? []).map(k => caches.delete(k)))
    } catch { /* ingen caches */ }
    // Query-strengen tvinger en frisk hentning også på en telefon der holder fast.
    window.location.replace(`${window.location.pathname}?v=${Date.now()}`)
  }

  if (!ny) return null

  return (
    <button
      onClick={opdater}
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-gray-900 py-2.5 text-sm font-semibold text-white"
    >
      <RefreshCw size={15} /> Ny version klar — tryk for at opdatere
    </button>
  )
}
