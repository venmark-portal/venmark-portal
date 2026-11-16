'use client'

// Diktat-optageren. Optager lyd i browseren og sender den til vores egen server, som
// sender den videre til talemodellen med vores varenavne som ordbog.
//
// Hvorfor optage i stedet for at skrive mens man taler: browserens egen genkendelse
// klipper ved pauser og springer varenavne over ("10 kW" i stedet for "10 kg
// laksefilet", Claus 16-11). Man optager, slipper, og får hele sætningen — samme
// rækkefølge som en talebesked.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface DiktatValg {
  /** Stop af sig selv, når der har været stille så længe (ms). 0 = brugeren trykker Stop.
   *  Robotsamtalen skal være håndfri, så dér lytter vi på lyden og klipper selv.
   *
   *  Vær rundhåndet her. Med 1,8 sek. blev én bestilling klippet i tre: "Prøv så lige at
   *  lægge" / "i 14-17 bakker" / "60 kilo i alt" — og robotten svarede på hver stump for
   *  sig (Claus 16-11). Folk tænker midt i en bestilling. */
  stilhedMs?: number
  /** Hvor længe vi venter på, at der kommer tale i det hele taget (ms). */
  opstartMs?: number
  /** Så lidt tale må en optagelse ikke klippes efter (ms). Et "øh" eller et host må ikke
   *  tælle som en færdig sætning. */
  mindstTaleMs?: number
  /** Optagelsen er slut og teksten afleveret. `fikTekst` er falsk, hvis der ikke kom ord
   *  ud af den — så ved en åben samtale, at den skal lytte igen i stedet for at svare. */
  onSlut?: (fikTekst: boolean) => void
}

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
  /** Stopper og smider optagelsen væk — fx når samtalen lægges på midt i en sætning. */
  afbryd: () => void
}

/** Længste optagelse. Et glemt tryk må ikke blive til en times lyd. */
const MAKS_MS = 90_000

export function useDiktat(
  onTekst: (tekst: string) => void,
  ord: () => string[] = () => [],
  valg: DiktatValg = {},
): Diktat {
  const [klar, setKlar] = useState(false)
  const [optager, setOptager] = useState(false)
  const [skriver, setSkriver] = useState(false)
  const [fejl, setFejl] = useState('')
  const optagerRef = useRef<MediaRecorder | null>(null)
  const bidderRef = useRef<BlobPart[]>([])
  const stopperRef = useRef(0)
  const ordRef = useRef(ord)
  const tekstRef = useRef(onTekst)
  const valgRef = useRef(valg)
  ordRef.current = ord
  tekstRef.current = onTekst
  valgRef.current = valg
  // Lytningen på lydstyrken: AudioContext'en genbruges, fordi en ny der laves uden for
  // et tryk starter suspenderet på iPhone — og så måler vi stilhed hele vejen.
  const lydCtxRef = useRef<AudioContext | null>(null)
  const maalerRef = useRef(0)
  const taltRef = useRef(false)
  const afbrudtRef = useRef(false)
  const startTidRef = useRef(0)

  const stopMaaler = useCallback(() => {
    window.clearInterval(maalerRef.current)
    maalerRef.current = 0
  }, [])

  useEffect(() => {
    let levende = true
    fetch('/api/tale/transskriber')
      .then(r => (r.ok ? r.json() : { klar: false }))
      .then(d => { if (levende) setKlar(!!d.klar) })
      .catch(() => {})
    return () => {
      levende = false
      window.clearTimeout(stopperRef.current)
      window.clearInterval(maalerRef.current)
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
    afbrudtRef.current = false
    taltRef.current = !valgRef.current.stilhedMs   // måler vi ikke, antager vi der blev talt
    m.ondataavailable = e => { if (e.data.size) bidderRef.current.push(e.data) }
    m.onstop = async () => {
      window.clearTimeout(stopperRef.current)
      stopMaaler()
      try { stream.getTracks().forEach(t => t.stop()) } catch {}
      optagerRef.current = null
      setOptager(false)
      const lyd = new Blob(bidderRef.current, { type: m.mimeType || 'audio/webm' })
      bidderRef.current = []
      const slut = valgRef.current.onSlut
      if (afbrudtRef.current) { slut?.(false); return }
      // Hørte vi aldrig nogen tale, er der ingen grund til at sende 9 sekunders stilhed
      // op i skyen og betale for den.
      if (!taltRef.current || lyd.size < 1200) {
        if (!valgRef.current.stilhedMs) setFejl('Hørte ingenting — prøv igen, og tal tæt på telefonen.')
        slut?.(false)
        return
      }
      setSkriver(true)
      let fikTekst = false
      try {
        const form = new FormData()
        form.append('lyd', lyd)
        form.append('ord', JSON.stringify(ordRef.current() ?? []))
        // Optagelsens længde logges på serveren. Uden den kan vi ikke se forskel på
        // "modellen hørte forkert" og "vi klippede for tidligt".
        form.append('ms', String(Date.now() - startTidRef.current))
        const res = await fetch('/api/tale/transskriber', { method: 'POST', body: form })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { setFejl(data.error ?? 'Talegenkendelsen svarede ikke'); return }
        const tekst = String(data.tekst ?? '').trim()
        if (tekst) { fikTekst = true; tekstRef.current(tekst) }
        else setFejl('Der kom ingen ord ud af optagelsen.')
      } catch {
        setFejl('Kunne ikke nå talegenkendelsen.')
      } finally {
        setSkriver(false)
        slut?.(fikTekst)
      }
    }
    optagerRef.current = m
    startTidRef.current = Date.now()
    m.start()
    setOptager(true)
    stopperRef.current = window.setTimeout(() => { try { m.stop() } catch {} }, MAKS_MS)

    if (!valgRef.current.stilhedMs) return
    const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext
    if (!AC) { taltRef.current = true; return }   // kan vi ikke måle, lader vi tiden løbe ud
    try {
      const ctx: AudioContext = lydCtxRef.current ?? (lydCtxRef.current = new AC())
      if (ctx.state === 'suspended') await ctx.resume()
      const kilde = ctx.createMediaStreamSource(stream)
      const maaler = ctx.createAnalyser()
      maaler.fftSize = 1024
      kilde.connect(maaler)
      const data = new Uint8Array(maaler.fftSize)
      const begyndt = Date.now()
      let sidsteLyd = begyndt
      let taleMs = 0
      let gulv = 1
      maalerRef.current = window.setInterval(() => {
        maaler.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v }
        const styrke = Math.sqrt(sum / data.length)
        const nu = Date.now()
        // Det første lille stykke bruges til at måle, hvor stille der FAKTISK er. En
        // kølemotor på lageret eller motorvejsstøj i bilen må ikke tælle som tale.
        if (nu - begyndt < 400) { gulv = Math.min(gulv, styrke); return }
        const graense = Math.max(0.02, gulv * 2.5 + 0.01)
        if (styrke > graense) { taltRef.current = true; taleMs += 100; sidsteLyd = nu; return }
        if (!taltRef.current) {
          if (nu - begyndt > (valgRef.current.opstartMs ?? 9000)) { try { m.stop() } catch {} }
          return
        }
        // Der skal være talt LÆNGE nok til, at det kan være en sætning. Ellers klipper et
        // host eller et "øh" bestillingen over, og robotten svarer på en stump.
        if (taleMs < (valgRef.current.mindstTaleMs ?? 700)) return
        if (nu - sidsteLyd > (valgRef.current.stilhedMs ?? 1800)) {
          try { kilde.disconnect() } catch {}
          try { m.stop() } catch {}
        }
      }, 100)
    } catch {
      // Kan vi ikke måle lyden, må optagelsen køre til tiden løber ud. Så er samtalen
      // langsom, men den går ikke i stå.
      taltRef.current = true
    }
  }, [stopMaaler])

  const stop = useCallback(() => {
    try { optagerRef.current?.stop() } catch { /* allerede stoppet */ }
  }, [])

  const afbryd = useCallback(() => {
    afbrudtRef.current = true
    try { optagerRef.current?.stop() } catch { /* allerede stoppet */ }
  }, [])

  return { klar, optager, skriver, fejl, start, stop, afbryd }
}
