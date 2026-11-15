'use client'

// Svar-robottens chatboks — flydende knap nederst til højre på alle portalsider.
// Vises kun for kunder admin har slået robotten til for (GET /api/portal/robot).
//
// Portalens menu bruger almindelige links (hel sidegenindlæsning), så samtalen gemmes i
// sessionStorage og overlever et sideskift. En ny fane = en ny samtale.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/portal/LangProvider'
import { robotDict } from '@/lib/i18n/portal/dict/robot'

interface Tur {
  rolle: 'kunde' | 'robot'
  tekst: string
  id?: number              // robottens svar-id (fra 'slut') — bruges til 👍/👎
  vurdering?: 1 | -1
  kommentarSendt?: boolean
  kurv?: boolean            // robotten ændrede kurven i dette svar → "Se kurven"
}

const NOEGLE = 'venmark-robot'
const HILST  = 'venmark-robot-hilst'

function nyId(): string {
  return (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function laes(): { samtaleId: string; ture: Tur[]; aaben: boolean } {
  try {
    const v = JSON.parse(sessionStorage.getItem(NOEGLE) ?? 'null')
    if (v?.samtaleId && Array.isArray(v.ture)) return v
  } catch {}
  return { samtaleId: nyId(), ture: [], aaben: false }
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

  // Gem samtalen ved hver ændring (ikke mens den første indlæsning står på).
  useEffect(() => {
    if (!samtaleId) return
    try { sessionStorage.setItem(NOEGLE, JSON.stringify({ samtaleId, ture, aaben })) } catch {}
  }, [samtaleId, ture, aaben])

  useEffect(() => {
    listeRef.current?.scrollTo({ top: listeRef.current.scrollHeight })
  }, [ture, opslag])

  const spoerg = useCallback(async (tekst: string, start = false, id = samtaleId) => {
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
        body: JSON.stringify(start ? { samtaleId: id, start: true } : { samtaleId: id, tekst }),
      })
      if (!res.ok || !res.body) {
        tilfoej(res.status === 429 ? t('loft') : t('fejl'))
        return
      }
      let kurvAendret = false
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
          if (h.t === 'tekst' && h.v) { setOpslag(''); tilfoej(h.v) }
          else if (h.t === 'vaerktoej') setOpslag(h.v ?? '')
          else if (h.t === 'ryd') setTure(prev => {
            // Robottens arbejdsnoter før et opslag — kun det endelige svar bliver stående.
            const kopi = prev.slice()
            kopi[kopi.length - 1] = { ...kopi[kopi.length - 1], tekst: '' }
            return kopi
          })
          else if (h.t === 'fejl') tilfoej(h.v ?? t('fejl'))
          else if (h.t === 'kurv') {
            kurvAendret = true
            setTure(prev => {
              const kopi = prev.slice()
              kopi[kopi.length - 1] = { ...kopi[kopi.length - 1], kurv: true }
              return kopi
            })
          }
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
      if (kurvAendret && window.location.pathname.startsWith('/portal/bestil')) {
        setTimeout(() => window.location.reload(), 600)
      }
    } catch {
      tilfoej(t('fejl'))
    } finally {
      setSvarer(false); setOpslag('')
      inputRef.current?.focus()
    }
  }, [samtaleId, t])

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
              <button type="button" onClick={() => setAaben(false)} aria-label={t('luk')}
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
                    <a href="/portal/bestil" className="mt-2 block w-fit rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
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
            <div className="flex items-end gap-2">
              <label htmlFor="robot-input" className="sr-only">{t('placeholder')}</label>
              <textarea
                id="robot-input"
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder={t('placeholder')}
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
