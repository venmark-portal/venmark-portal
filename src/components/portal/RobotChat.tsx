'use client'

// Svar-robottens chatboks — flydende knap nederst til højre på alle portalsider.
// Vises kun for kunder admin har slået robotten til for (GET /api/portal/robot).
//
// Portalens menu bruger almindelige links (hel sidegenindlæsning), så samtalen gemmes i
// sessionStorage og overlever et sideskift. En ny fane = en ny samtale.
//
// Stemme: browserens egen talegenkendelse (Web Speech API) laver tale om til tekst, og svaret
// læses op med browserens stemme — robotten får præcis samme tekst som hvis kunden skrev,
// så det koster ingen ekstra tokens. Spurgt med stemmen → svaret læses op (hænderne fri i bilen).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT, useLocale } from '@/lib/i18n/portal/LangProvider'
import { robotDict } from '@/lib/i18n/portal/dict/robot'

interface Tur {
  rolle: 'kunde' | 'robot'
  tekst: string
  id?: number              // robottens svar-id (fra 'slut') — bruges til 👍/👎
  vurdering?: 1 | -1
  kommentarSendt?: boolean
  kurv?: boolean            // robotten ændrede kurven i dette svar → "Se kurven"
  kurvDato?: string         // leveringsdagen robotten lagde i kurven til (YYYY-MM-DD) → vælges på bestillingssiden
}

const NOEGLE = 'venmark-robot'
const HILST  = 'venmark-robot-hilst'
const KALD   = 'venmark-robot-kald'

/** Efter så langt et ophold er samtalen slut — næste spørgsmål starter forfra. */
const PAUSE_MS = 2 * 60 * 60 * 1000
/** Stille runder i en åben stemmesamtale, før vi lægger på af os selv (ca. 2-4 minutter). */
const MAKS_STILLE = 12

function nyId(): string {
  return (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function laes(): { samtaleId: string; ture: Tur[]; aaben: boolean } {
  try {
    const v = JSON.parse(sessionStorage.getItem(NOEGLE) ?? 'null')
    if (v?.samtaleId && Array.isArray(v.ture)) {
      // En fane kan stå åben til næste dag. Kørte vi videre i samme samtale, talte robotten om
      // kurve og ordrer, der ikke findes mere, og vidste ikke at vi sidst talte i går (Claus 16-11).
      // Efter et ophold — eller over midnat — er det en ny samtale.
      const frisk = typeof v.tid === 'number'
        && Date.now() - v.tid < PAUSE_MS
        && new Date(v.tid).toDateString() === new Date().toDateString()
      return frisk ? v : { samtaleId: nyId(), ture: [], aaben: v.aaben === true }
    }
  } catch {}
  return { samtaleId: nyId(), ture: [], aaben: false }
}

/** Bestillingssiden med robottens leveringsdag valgt. */
function bestilUrl(dato?: string): string {
  return dato && /^\d{4}-\d{2}-\d{2}$/.test(dato) ? `/portal/bestil?dato=${dato}` : '/portal/bestil'
}

/** Talegenkenderen (Chrome/Edge/Safari) — Firefox har ingen. */
function talegenkender(): any {
  if (typeof window === 'undefined') return null
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null
}

/** Svaret som sætninger til oplæsning: uden **fed** og varenumre i parentes. Korte bidder, fordi
 *  Chrome stopper lange oplæsninger midtvejs. */
function oplaesningsBidder(tekst: string): string[] {
  return tekst
    .replace(/\*\*/g, '')
    .replace(/\s*\((\d{4,6})\)/g, '')
    .split(/(?<=[.!?:])\s+|\n+/)
    .map(s => s.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
}

/** **fed** og linjeskift — mere markdown skriver robotten ikke. */
function Tekst({ s }: { s: string }) {
  return (
    <>
      {s.split(/(\*\*[^*]+\*\*)/g).map((del, i) =>
        del.startsWith('**') && del.endsWith('**')
          ? <strong key={i}>{del.slice(2, -2)}</strong>
          : <span key={i}>{del}</span>)}
    </>
  )
}

/** 👍/👎 under et svar. Ved 👎 kan kunden skrive, hvad der var forkert (valgfrit). */
function Vurdering({ tur, t, onVurder }: { tur: Tur; t: (k: any) => string; onVurder: (v: 1 | -1, kommentar?: string) => void }) {
  const [tekst, setTekst] = useState('')
  const knap = (v: 1 | -1, ikon: string, label: string) => (
    <button type="button" onClick={() => onVurder(v)} aria-label={label} title={label} aria-pressed={tur.vurdering === v}
      className={'rounded px-1.5 py-0.5 text-sm transition ' + (tur.vurdering === v ? 'bg-white shadow-sm' : 'opacity-50 hover:opacity-100')}>
      {ikon}
    </button>
  )
  return (
    <div className="mt-1.5 whitespace-normal">
      <div className="flex items-center gap-1">
        {knap(1, '👍', t('godtSvar'))}
        {knap(-1, '👎', t('daarligtSvar'))}
        {tur.vurdering && <span className="ml-1 text-xs text-gray-500">{t('tak')}</span>}
      </div>
      {tur.vurdering === -1 && !tur.kommentarSendt && (
        <form className="mt-1.5 flex gap-1" onSubmit={e => { e.preventDefault(); if (tekst.trim()) onVurder(-1, tekst.trim()) }}>
          <input value={tekst} onChange={e => setTekst(e.target.value)} placeholder={t('hvadForkert')} maxLength={1000}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-base md:text-xs" />
          <button className="rounded-lg bg-gray-700 px-2 py-1 text-xs text-white">{t('send')}</button>
        </form>
      )}
    </div>
  )
}

export default function RobotChat() {
  const t = useT(robotDict)
  const locale = useLocale()
  const [aktiv, setAktiv]         = useState(false)
  const [initiativ, setInitiativ] = useState(false)
  const [aaben, setAaben]         = useState(false)
  const [samtaleId, setSamtaleId] = useState('')
  const [ture, setTure]           = useState<Tur[]>([])
  const [input, setInput]         = useState('')
  const [svarer, setSvarer]       = useState(false)
  const [opslag, setOpslag]       = useState('')
  const listeRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const startet  = useRef(false)

  // Stemme
  const [kanTale, setKanTale]       = useState(false)
  const [lytter, setLytter]         = useState(false)
  const [taler, setTaler]           = useState(false)
  const [iKald, setIKald]           = useState(false)   // åben stemmesamtale (håndfri)
  const [stemmeFejl, setStemmeFejl] = useState('')
  const genkender = useRef<any>(null)
  const oplaes    = useRef(false)   // spørgsmålet blev talt → læs svaret op
  // Samtalen holdes åben, til kunden lægger på. Tilstanden ligger i refs, fordi
  // talegenkenderens og oplæsningens tilbagekald fyrer før React har gentegnet.
  const kald      = useRef(false)
  const stille    = useRef(0)
  const talerRef  = useRef(false)
  const svarerRef = useRef(false)
  const lytRef    = useRef<(nytKald?: boolean) => void>(() => {})

  useEffect(() => { setKanTale(!!talegenkender()) }, [])

  const saetTaler = (v: boolean) => { talerRef.current = v; setTaler(v) }

  const stopOplaesning = () => {
    try { window.speechSynthesis?.cancel() } catch {}
    saetTaler(false)
  }

  /** Læg på: luk mikrofonen og oplæsningen, og hold op med at lytte igen. */
  const laegPaa = () => {
    kald.current = false
    stille.current = 0
    setIKald(false)
    try { sessionStorage.removeItem(KALD) } catch {}
    try { genkender.current?.abort() } catch {}
    genkender.current = null
    setLytter(false)
    stopOplaesning()
  }

  /** Læs svaret op. `derefter` kører når oplæsningen er færdig (eller ikke kan køre). */
  const laesOp = (tekst: string, derefter?: () => void) => {
    const ss = typeof window !== 'undefined' ? window.speechSynthesis : undefined
    const bidder = oplaesningsBidder(tekst)
    if (!ss || !bidder.length) { derefter?.(); return }
    ss.cancel()
    const sprog = locale.slice(0, 2).toLowerCase()
    const stemme = ss.getVoices().find(v => v.lang.replace('_', '-').toLowerCase().startsWith(sprog))
    saetTaler(true)
    bidder.forEach((b, i) => {
      const u = new SpeechSynthesisUtterance(b)
      u.lang = locale
      if (stemme) u.voice = stemme
      if (i === bidder.length - 1) u.onend = () => { saetTaler(false); derefter?.() }
      u.onerror = () => { saetTaler(false); if (i === bidder.length - 1) derefter?.() }
      ss.speak(u)
    })
  }

  // Gem samtalen ved hver ændring (ikke mens den første indlæsning står på).
  useEffect(() => {
    if (!samtaleId) return
    try { sessionStorage.setItem(NOEGLE, JSON.stringify({ samtaleId, ture, aaben, tid: Date.now() })) } catch {}
  }, [samtaleId, ture, aaben])

  // Altid nederst — også når panelet først vises (efter status-kaldet ved genindlæsning, fx når
  // robotten har lagt i kurven, eller når kunden åbner chatten). Ellers står samtalen øverst.
  useEffect(() => {
    listeRef.current?.scrollTo({ top: listeRef.current.scrollHeight })
  }, [ture, opslag, aktiv, aaben])

  const spoerg = useCallback(async (tekst: string, start = false, id = samtaleId) => {
    // Talt spørgsmål → serveren svarer kortere (det skal kunne læses op), og svaret læses op.
    const medStemme = oplaes.current || kald.current
    svarerRef.current = true
    setSvarer(true); setOpslag('')
    setTure(prev => [...prev, ...(start ? [] : [{ rolle: 'kunde' as const, tekst }]), { rolle: 'robot' as const, tekst: '' }])
    const tilfoej = (bid: string) => setTure(prev => {
      const kopi = prev.slice()
      const sidst = kopi[kopi.length - 1]
      kopi[kopi.length - 1] = { ...sidst, tekst: sidst.tekst + bid }
      return kopi
    })
    try {
      const res = await fetch('/api/portal/robot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(start ? { samtaleId: id, start: true } : { samtaleId: id, tekst, stemme: medStemme }),
      })
      if (!res.ok || !res.body) {
        tilfoej(res.status === 429 ? t('loft') : t('fejl'))
        return
      }
      let kurvAendret = false
      let kurvDato = ''
      let ordreAendret = false
      let svar = ''   // det endelige svar (til oplæsning)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const dele = buf.split('\n\n')
        buf = dele.pop() ?? ''
        for (const d of dele) {
          if (!d.startsWith('data: ')) continue
          const h = JSON.parse(d.slice(6)) as { t: string; v?: string }
          if (h.t === 'tekst' && h.v) { setOpslag(''); tilfoej(h.v); svar += h.v }
          else if (h.t === 'vaerktoej') setOpslag(h.v ?? '')
          else if (h.t === 'ryd') {
            // Robottens arbejdsnoter før et opslag — kun det endelige svar bliver stående.
            svar = ''
            setTure(prev => {
              const kopi = prev.slice()
              kopi[kopi.length - 1] = { ...kopi[kopi.length - 1], tekst: '' }
              return kopi
            })
          }
          else if (h.t === 'fejl') tilfoej(h.v ?? t('fejl'))
          else if (h.t === 'kurv') {
            kurvAendret = true
            kurvDato = h.v ?? ''
            setTure(prev => {
              const kopi = prev.slice()
              kopi[kopi.length - 1] = { ...kopi[kopi.length - 1], kurv: true, kurvDato: kurvDato || undefined }
              return kopi
            })
          }
          else if (h.t === 'ordre') ordreAendret = true
          else if (h.t === 'slut' && h.v) {
            const id = Number(h.v)
            setTure(prev => {
              const kopi = prev.slice()
              kopi[kopi.length - 1] = { ...kopi[kopi.length - 1], id }
              return kopi
            })
          }
        }
      }
      // Står kunden på bestillingssiden, viser den stadig den gamle kurv — og ville gemme den
      // oven i robottens ved næste ændring. Genindlæs (samtalen ligger i sessionStorage).
      // Flyttet leveringsdag: ordresiden viser stadig den gamle dag.
      let genindlaes: (() => void) | null = null
      if (kurvAendret && window.location.pathname.startsWith('/portal/bestil')) {
        genindlaes = () => { window.location.href = bestilUrl(kurvDato) }
      } else if (ordreAendret && window.location.pathname.startsWith('/portal/ordrer')) {
        genindlaes = () => window.location.reload()
      }
      // I en åben samtale lytter vi igen, så snart svaret er læst op — kunden skal ikke røre
      // telefonen mellem hvert spørgsmål. Skal siden genindlæses, tager den sig selv af det
      // (KALD-flaget i sessionStorage), så samtalen fortsætter efter genindlæsningen.
      const genoptag = () => { if (kald.current) window.setTimeout(() => lytRef.current?.(), 250) }
      // Spurgt med stemmen → læs svaret op; genindlæs først bagefter, så oplæsningen ikke afbrydes.
      if (medStemme && svar.trim()) laesOp(svar, () => { if (genindlaes) genindlaes(); else genoptag() })
      else if (genindlaes) setTimeout(genindlaes, 600)
      else genoptag()
    } catch {
      tilfoej(t('fejl'))
      if (kald.current) window.setTimeout(() => lytRef.current?.(), 400)
    } finally {
      oplaes.current = false
      svarerRef.current = false
      setSvarer(false); setOpslag('')
      if (!kald.current) inputRef.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samtaleId, t, locale])

  /** Mikrofon: tal → teksten vises i feltet mens man taler → sendes når man holder pause.
   *
   *  `nytKald` = kunden trykkede på mikrofonen. Så er det en ÅBEN samtale: vi lytter igen efter
   *  hvert svar, og den slutter først, når kunden lægger på. Før lukkede mikrofonen af sig selv,
   *  så snart robotten begyndte at tale, og man skulle trykke forfra hver gang (Claus 16-11).
   *  Vi lytter ikke, mens robotten taler — ellers hører den sig selv i højttaleren. */
  const startLyt = (nytKald = false) => {
    const SR = talegenkender()
    if (!SR) return
    if (nytKald) {
      kald.current = true
      stille.current = 0
      setIKald(true)
      try { sessionStorage.setItem(KALD, String(Date.now())) } catch {}
    }
    if (genkender.current || svarerRef.current || talerRef.current) return
    stopOplaesning(); setStemmeFejl('')
    // iOS kræver at oplæsning startes i et klik — en tom oplæsning "låser op" til svaret.
    try { window.speechSynthesis?.speak(new SpeechSynthesisUtterance('')) } catch {}
    const r = new SR()
    r.lang = locale
    r.interimResults = true
    r.continuous = false
    let endelig = ''
    r.onresult = (e: any) => {
      let midlertidig = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const x = e.results[i]
        if (x.isFinal) endelig += x[0].transcript
        else midlertidig += x[0].transcript
      }
      setInput((endelig + midlertidig).trim())
    }
    r.onerror = (e: any) => {
      // Er mikrofonen ikke til at redde, er en åben samtale også slut — ellers prøver vi igen
      // og igen uden at kunden kan se hvorfor.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { setStemmeFejl(t('mikNaegtet')); laegPaa() }
      else if (e.error === 'audio-capture') { setStemmeFejl(t('stemmeFejl')); laegPaa() }
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setStemmeFejl(t('stemmeFejl'))
    }
    r.onend = () => {
      setLytter(false); genkender.current = null
      const tekst = endelig.trim()
      if (tekst) { stille.current = 0; setInput(''); oplaes.current = true; spoerg(tekst); return }
      if (!kald.current) return
      // Stilhed: i en åben samtale lytter vi videre — kunden lægger selv på. Men mikrofonen må
      // ikke stå åben for evigt i lommen, så efter en lang stilhed lægger vi på af os selv.
      stille.current += 1
      if (stille.current >= MAKS_STILLE) { laegPaa(); return }
      window.setTimeout(() => { if (kald.current) lytRef.current?.() }, 300)
    }
    genkender.current = r
    setLytter(true)
    // Holdes frisk, så en samtale der har kørt et stykke tid også tages op efter en genindlæsning.
    if (kald.current) { try { sessionStorage.setItem(KALD, String(Date.now())) } catch {} }
    try { r.start() } catch { setLytter(false); genkender.current = null }
  }
  lytRef.current = startLyt

  // Første indlæsning: er robotten slået til, og skal den selv starte samtalen?
  useEffect(() => {
    const gemt = laes()
    setSamtaleId(gemt.samtaleId); setTure(gemt.ture); setAaben(gemt.aaben)
    fetch('/api/portal/robot', { cache: 'no-store' })
      .then(r => r.json())
      .then((s: { aktiv: boolean; initiativ: boolean }) => {
        setAktiv(s.aktiv); setInitiativ(s.initiativ)
        let hilst = false
        try { hilst = sessionStorage.getItem(HILST) === '1' } catch {}
        if (s.aktiv && s.initiativ && !hilst && gemt.ture.length === 0 && !startet.current) {
          startet.current = true
          try { sessionStorage.setItem(HILST, '1') } catch {}
          setAaben(true)
          spoerg('', true, gemt.samtaleId)
          return
        }
        // Blev en åben stemmesamtale afbrudt af en genindlæsning (robotten lagde i kurven), så
        // tag den op igen — ellers skal kunden røre telefonen midt i en bilsamtale. Kun lige
        // efter, så mikrofonen ikke åbner af sig selv næste gang portalen bruges.
        let kaldTid = 0
        try { kaldTid = Number(sessionStorage.getItem(KALD) ?? 0) } catch {}
        if (s.aktiv && kaldTid > 0 && Date.now() - kaldTid < 90_000 && talegenkender()) {
          setAaben(true)
          window.setTimeout(() => lytRef.current?.(true), 500)
        } else if (kaldTid) {
          try { sessionStorage.removeItem(KALD) } catch {}
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = () => {
    const tekst = input.trim()
    if (!tekst || svarer) return
    setInput('')
    spoerg(tekst)
  }

  const vurder = async (idx: number, vurdering: 1 | -1, kommentar?: string) => {
    const tur = ture[idx]
    if (!tur?.id) return
    setTure(prev => prev.map((x, i) => i === idx ? { ...x, vurdering, kommentarSendt: x.kommentarSendt || !!kommentar } : x))
    await fetch('/api/portal/robot/vurdering', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tur.id, vurdering, kommentar }),
    }).catch(() => {})
  }

  const nySamtale = () => {
    if (svarer) return
    stopOplaesning()
    setSamtaleId(nyId()); setTure([])
  }

  const skiftInitiativ = async (v: boolean) => {
    setInitiativ(v)
    await fetch('/api/portal/robot', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initiativ: v }),
    }).catch(() => {})
  }

  if (!aktiv) return null

  const opslagTekst = opslag ? (t(`vt_${opslag}` as any) || t('slaarOp')) : t('slaarOp')

  return (
    <>
      {!aaben && (
        <button
          type="button"
          onClick={() => { setAaben(true); setTimeout(() => inputRef.current?.focus(), 50) }}
          aria-label={t('aabn')}
          title={t('aabn')}
          // Over notifikations-klokken (PushSubscribeButton: bottom-20 / md:bottom-6, right-4).
          className="fixed bottom-[8.25rem] right-3 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 md:bottom-[4.5rem] md:right-3"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5m-9 6 3-3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v13Z" />
          </svg>
        </button>
      )}

      {aaben && (
        <section
          aria-label={t('titel')}
          className="fixed inset-x-0 bottom-0 z-50 flex h-[80vh] flex-col rounded-t-2xl border border-gray-200 bg-white shadow-2xl md:inset-x-auto md:bottom-6 md:right-6 md:h-[600px] md:max-h-[calc(100vh-3rem)] md:w-[400px] md:rounded-2xl"
        >
          <header className="flex items-start justify-between gap-2 border-b border-gray-100 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900">{t('titel')}</h2>
              <p className="text-xs text-gray-500">{t('undertitel')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={nySamtale} disabled={svarer}
                className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40">
                {t('ny')}
              </button>
              <button type="button" onClick={() => { laegPaa(); setAaben(false) }} aria-label={t('luk')}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>
          </header>

          <div ref={listeRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
            {ture.length === 0 && (
              <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-gray-700">{t('velkommen')}</p>
            )}
            {ture.map((tur, i) => (
              <div key={i} className={tur.rolle === 'kunde' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={
                  'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ' +
                  (tur.rolle === 'kunde' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900')
                }>
                  {tur.tekst
                    ? <Tekst s={tur.tekst} />
                    : <span className="text-gray-500">{opslagTekst}</span>}
                  {tur.kurv && (
                    <a href={bestilUrl(tur.kurvDato)} className="mt-2 block w-fit rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
                      {t('seKurven')}
                    </a>
                  )}
                  {tur.rolle === 'robot' && tur.id && (
                    <Vurdering tur={tur} t={t} onVurder={(v, k) => vurder(i, v, k)} />
                  )}
                </div>
              </div>
            ))}
            {svarer && opslag && ture[ture.length - 1]?.tekst && (
              <p className="text-xs text-gray-500">{opslagTekst}</p>
            )}
          </div>

          <div className="border-t border-gray-100 px-3 pb-3 pt-2">
            {taler && (
              // I en åben samtale betyder "stop oplæsning" også "nu vil jeg sige noget" — så
              // lytter vi med det samme i stedet for at vente oplæsningen ud.
              <button type="button" onClick={() => { stopOplaesning(); if (kald.current) window.setTimeout(() => lytRef.current?.(), 150) }}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200">
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1.5" /></svg>
                {iKald ? t('minTur') : t('stopOplaesning')}
              </button>
            )}
            {iKald && (
              <p className="mb-2 flex items-center gap-2 rounded-lg bg-blue-50 px-2 py-1.5 text-xs text-blue-900">
                <span className={'h-2 w-2 shrink-0 rounded-full ' + (lytter ? 'animate-pulse bg-red-600' : 'bg-blue-400')} aria-hidden="true" />
                <span className="font-medium">{taler ? t('robotTaler') : lytter ? t('lytter') : t('etOejeblik')}</span>
                <span className="ml-auto shrink-0 text-blue-700">{t('kaldAaben')}</span>
              </p>
            )}
            {stemmeFejl && <p className="mb-2 text-xs text-red-600">{stemmeFejl}</p>}
            <div className="flex items-end gap-2">
              {kanTale && (iKald ? (
                // Åben samtale: kunden lægger selv på, når han ikke vil mere.
                <button type="button" onClick={laegPaa}
                  aria-label={t('laegPaa')} title={t('laegPaa')}
                  className="flex h-[42px] shrink-0 items-center gap-1.5 rounded-xl bg-red-600 px-3 text-sm font-semibold text-white transition hover:bg-red-700">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7c6-4 12-4 18 0l-2.2 3.3a2 2 0 0 1-2.4.7l-1.7-.7a2 2 0 0 1-1.2-1.8V7.2c-1.7-.3-3.3-.3-5 0v1.3a2 2 0 0 1-1.2 1.8l-1.7.7a2 2 0 0 1-2.4-.7L3 7Zm1 14L21 4" />
                  </svg>
                  {t('laegPaa')}
                </button>
              ) : (
                <button type="button" onClick={() => startLyt(true)} disabled={svarer}
                  aria-label={t('tal')} title={t('tal')}
                  className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-700 transition hover:bg-gray-200 disabled:opacity-40">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path strokeLinecap="round" d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                </button>
              ))}
              <label htmlFor="robot-input" className="sr-only">{t('placeholder')}</label>
              <textarea
                id="robot-input"
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder={lytter ? t('lytter') : t('placeholder')}
                maxLength={2000}
                className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 md:text-sm"
              />
              <button type="button" onClick={send} disabled={svarer || !input.trim()}
                className="h-[42px] rounded-xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
                {t('send')}
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
              <input id="robot-initiativ" type="checkbox" checked={initiativ}
                onChange={e => skiftInitiativ(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300" />
              {t('initiativ')}
            </label>
            <p className="mt-1 text-[11px] text-gray-400">{t('forbehold')}</p>
          </div>
        </section>
      )}
    </>
  )
}
