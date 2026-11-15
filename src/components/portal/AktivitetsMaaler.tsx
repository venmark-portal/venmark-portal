'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

// Logger portal-brug (se src/lib/aktivitet.ts): én sidevisning pr. sideskift og en puls
// hvert minut mens fanen er synlig og brugeren har været aktiv inden for 2 minutter.
// Gemmer intet på enheden.

const PULS_MS   = 60_000
const INAKTIV_MS = 120_000

function send(data: Record<string, unknown>) {
  const body = JSON.stringify({ ...data, mobil: window.matchMedia('(max-width: 767px)').matches })
  fetch('/api/portal/aktivitet', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
  }).catch(() => {})
}

export default function AktivitetsMaaler() {
  const sti = usePathname()
  const sidstAktiv = useRef(Date.now())

  useEffect(() => {
    if (sti) send({ type: 'side', sti })
  }, [sti])

  useEffect(() => {
    const aktiv = () => { sidstAktiv.current = Date.now() }
    const haendelser = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'] as const
    haendelser.forEach(h => window.addEventListener(h, aktiv, { passive: true }))
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - sidstAktiv.current > INAKTIV_MS) return
      send({ type: 'puls' })
    }, PULS_MS)
    return () => {
      haendelser.forEach(h => window.removeEventListener(h, aktiv))
      window.clearInterval(timer)
    }
  }, [])

  return null
}
