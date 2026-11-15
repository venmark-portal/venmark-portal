'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * Hvad denne enhed kan, og hvilken udgave den kører.
 *
 * Uden den er en telefon umulig at fejlsøge på afstand: "der sker ikke noget" kan
 * være en gammel side i cachen, eller en browser der slet ikke har funktionen.
 * Kamera-scanning og indtaling findes nemlig ikke alle steder — kun i Chrome på
 * Android, ChromeOS og macOS. På en iPhone er der ingen af delene, og der bruger
 * man i stedet mikrofon-tasten på iOS' eget tastatur, når bemærkningen skal indtales.
 */
export default function OmAppen() {
  const [version, setVersion] = useState('')
  const [kamera, setKamera] = useState(false)
  const [tale, setTale] = useState(false)
  const [rydder, setRydder] = useState(false)

  useEffect(() => {
    setKamera('BarcodeDetector' in window)
    setTale(!!((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition))
    fetch('/api/lager/version', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setVersion(String(d.version ?? '').slice(0, 8)))
      .catch(() => {})
  }, [])

  async function opdater() {
    setRydder(true)
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.()
      await Promise.all((regs ?? []).map(r => r.unregister()))
    } catch { /* ingen service worker */ }
    try {
      const n = await caches?.keys?.()
      await Promise.all((n ?? []).map(k => caches.delete(k)))
    } catch { /* ingen caches */ }
    window.location.replace(`${window.location.pathname}?v=${Date.now()}`)
  }

  return (
    <div className="mt-8 border-t border-gray-200 pt-4 text-center">
      <p className="text-[11px] text-gray-400">
        Udgave {version || '…'} · kamera-scanning {kamera ? 'ja' : 'nej'} · indtaling {tale ? 'ja' : 'nej'}
      </p>
      <button
        onClick={opdater}
        disabled={rydder}
        className="mt-2 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-gray-500 ring-1 ring-gray-300 disabled:opacity-40"
      >
        <RefreshCw size={13} /> {rydder ? 'Henter …' : 'Hent nyeste udgave'}
      </button>
    </div>
  )
}
