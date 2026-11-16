'use client'

// Diktat-optageren. Optager lyd i browseren og sender den til vores egen server, som
// sender den videre til talemodellen med vores varenavne som ordbog.
//
// Hvorfor optage i stedet for at skrive mens man taler: browserens egen genkendelse
// klipper ved pauser og springer varenavne over ("10 kW" i stedet for "10 kg
// laksefilet", Claus 16-11). Man optager, slipper, og får hele sætningen — samme
// rækkefølge som en talebesked.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface Diktat {
  /** Har serveren en nøgle? Ellers skal skærmen bruge browserens egen genkendelse. */
  klar: boolean
  optager: boolean
  /** Lyden er sendt, teksten er på vej. */
  skriver: boolean
  fejl: string
  start: () => Promise<void>
  /** Stopper og afleverer teksten. */
  stop: () => void
}

/** Længste optagelse. Et glemt tryk må ikke blive til en times lyd. */
const MAKS_MS = 90_000

export function useDiktat(onTekst: (tekst: string) => void, ord: () => string[] = () => []): Diktat {
  const [klar, setKlar] = useState(false)
  const [optager, setOptager] = useState(false)
  const [skriver, setSkriver] = useState(false)
  const [fejl, setFejl] = useState('')
  const optagerRef = useRef<MediaRecorder | null>(null)
  const bidderRef = useRef<BlobPart[]>([])
  const stopperRef = useRef(0)
  const ordRef = useRef(ord)
  const tekstRef = useRef(onTekst)
  ordRef.current = ord
  tekstRef.current = onTekst

  useEffect(() => {
    let levende = true
    fetch('/api/tale/transskriber')
      .then(r => (r.ok ? r.json() : { klar: false }))
      .then(d => { if (levende) setKlar(!!d.klar) })
      .catch(() => {})
    return () => {
      levende = false
      window.clearTimeout(stopperRef.current)
      try { optagerRef.current?.stream.getTracks().forEach(t => t.stop()) } catch {}
    }
  }, [])

  const start = useCallback(async () => {
    setFejl('')
    if (optagerRef.current) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setFejl('Mikrofonen er ikke tilladt. Giv adgang i låse-ikonet ved adressen.')
      return
    }
    // Browseren vælger selv formatet: Chrome giver webm/opus, Safari mp4. Serveren
    // sætter filendelsen efter typen, så begge dele kan læses.
    const m = new MediaRecorder(stream)
    bidderRef.current = []
    m.ondataavailable = e => { if (e.data.size) bidderRef.current.push(e.data) }
    m.onstop = async () => {
      window.clearTimeout(stopperRef.current)
      try { stream.getTracks().forEach(t => t.stop()) } catch {}
      optagerRef.current = null
      setOptager(false)
      const lyd = new Blob(bidderRef.current, { type: m.mimeType || 'audio/webm' })
      bidderRef.current = []
      if (lyd.size < 1200) { setFejl('Hørte ingenting — prøv igen, og tal tæt på telefonen.'); return }
      setSkriver(true)
      try {
        const form = new FormData()
        form.append('lyd', lyd)
        form.append('ord', JSON.stringify(ordRef.current() ?? []))
        const res = await fetch('/api/tale/transskriber', { method: 'POST', body: form })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { setFejl(data.error ?? 'Talegenkendelsen svarede ikke'); return }
        const tekst = String(data.tekst ?? '').trim()
        if (tekst) tekstRef.current(tekst)
        else setFejl('Der kom ingen ord ud af optagelsen.')
      } catch {
        setFejl('Kunne ikke nå talegenkendelsen.')
      } finally {
        setSkriver(false)
      }
    }
    optagerRef.current = m
    m.start()
    setOptager(true)
    stopperRef.current = window.setTimeout(() => { try { m.stop() } catch {} }, MAKS_MS)
  }, [])

  const stop = useCallback(() => {
    try { optagerRef.current?.stop() } catch { /* allerede stoppet */ }
  }, [])

  return { klar, optager, skriver, fejl, start, stop }
}
