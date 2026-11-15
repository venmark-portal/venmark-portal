'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowLeft, Check, CircleCheck, Hash, Layers, Pencil, Plus, Send, Trash2,
} from 'lucide-react'
import ScanFelt from '@/components/lager/ScanFelt'
import { nyNoegle } from '@/lib/lager/device'

interface Hylde { id: string; locationCode: string; code: string; name: string; sortOrder: number }
interface Vare {
  itemNo: string; description: string; total: number; uom: string
  antal: number; estimated: boolean; confirmed: boolean; shelves: string
  bcAntal: number | null; afvigelse: number | null
}
interface Optaelling {
  id: string; no: string; locationCode: string; status: string; createdByName: string
  blind: boolean
  bcLinesWritten: number | null; bcDiffLines: number | null
}

/** Tal som lageret læser dem: 1.250,5 — og uden decimalhalehæng på hele tal. */
function tal(n: number): string {
  return n.toLocaleString('da-DK', { maximumFractionDigits: 3 })
}

export default function OptaellingSide() {
  const [mig, setMig] = useState<any>(null)
  const [optaelling, setOptaelling] = useState<Optaelling | null>(null)
  const [aabne, setAabne] = useState<Optaelling[]>([])
  const [lokation, setLokation] = useState('')
  const [hylder, setHylder] = useState<Hylde[]>([])
  const [hylde, setHylde] = useState('')
  const [varer, setVarer] = useState<Vare[]>([])
  const [aktiv, setAktiv] = useState<
    { itemNo: string; navn: string; uom: string; total: number; antal: number; bcAntal: number | null } | null
  >(null)
  const [blind, setBlind] = useState(false)
  const [besked, setBesked] = useState<{ slags: 'ok' | 'advar' | 'fejl'; tekst: string } | null>(null)
  const [travl, setTravl] = useState(false)
  const [anslaa, setAnslaa] = useState(false)

  const lydRef = useRef<AudioContext | null>(null)
  const bip = useCallback((hz: number, ms: number) => {
    try {
      lydRef.current ??= new AudioContext()
      const ctx = lydRef.current
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.frequency.value = hz
      g.gain.value = 0.08
      osc.connect(g).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + ms / 1000)
    } catch { /* lyd er pynt */ }
  }, [])

  useEffect(() => {
    fetch('/api/lager/me').then(r => r.json()).then(m => {
      setMig(m)
      setLokation(m.lokation || m.lokationer?.[0]?.kode || '')
    }).catch(() => {})
    fetch('/api/lager/optaelling').then(r => r.json()).then(setAabne).catch(() => {})
  }, [])

  useEffect(() => {
    if (!lokation) return
    fetch(`/api/lager/hylder?locationCode=${encodeURIComponent(lokation)}`)
      .then(r => r.json()).then(setHylder).catch(() => {})
  }, [lokation])

  async function hentStatus(id: string) {
    const r = await fetch(`/api/lager/optaelling/${id}`).then(x => x.json())
    setOptaelling(r.optaelling)
    setVarer(r.varer ?? [])
  }

  async function start() {
    setTravl(true)
    try {
      const r = await fetch('/api/lager/optaelling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationCode: lokation, blind }),
      }).then(x => x.json())
      if (r.id) { setOptaelling(r); setVarer([]) }
    } finally { setTravl(false) }
  }

  async function scan(kode: string) {
    if (!optaelling) return
    setTravl(true)
    setBesked(null)
    try {
      const r = await fetch('/api/lager/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: kode, locationCode: optaelling.locationCode, context: 'optaelling' }),
      })
      if (!r.ok) { bip(220, 250); setBesked({ slags: 'fejl', tekst: 'BC svarer ikke — prøv igen' }); return }

      const v = await r.json()
      if (!v.found) {
        bip(300, 200)
        navigator.vibrate?.(120)
        setBesked({ slags: 'advar', tekst: `Ukendt kode ${kode} — lær den på forsiden, eller find varen i søgningen` })
        return
      }

      // Kasse- og lot-koder sidder på ÉN fysisk kasse: serveren afviser en gentagelse.
      const unikKasse = v.codeType === 'kasse' || v.codeType === 'lot'
      const res = await fetch(`/api/lager/optaelling/${optaelling.id}/linje`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemNo: v.itemNo, description: v.description, qty: v.quantity,
          uom: v.baseUnitOfMeasure, shelfCode: hylde || undefined, lotNo: v.lotNo || undefined,
          barcode: kode, unikKasse, bcQty: v.inventory, idempotencyKey: nyNoegle(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        bip(300, 220)
        navigator.vibrate?.(200)
        setBesked({ slags: 'advar', tekst: data.error ?? 'Kunne ikke gemme' })
        return
      }

      bip(880, 80)
      setAktiv({
        itemNo: v.itemNo, navn: v.description, uom: v.baseUnitOfMeasure,
        total: data.total, antal: data.antal,
        bcAntal: optaelling.blind ? null : v.inventory,
      })
      setVarer(await fetch(`/api/lager/optaelling/${optaelling.id}`).then(x => x.json()).then(x => x.varer ?? []))
    } finally { setTravl(false) }
  }

  async function faerdigMedVaren() {
    if (!optaelling || !aktiv) return
    setTravl(true)
    try {
      const r = await fetch(`/api/lager/optaelling/${optaelling.id}/tjek`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemNo: aktiv.itemNo }),
      }).then(x => x.json())

      if (!r.kunneTjekkes) {
        setBesked({ slags: 'advar', tekst: 'Kunne ikke tjekkes mod BC — tællingen er gemt' })
      } else if (r.stemmer) {
        bip(1040, 90)
        setBesked({ slags: 'ok', tekst: `${aktiv.itemNo} stemmer` })
      } else {
        bip(300, 400)
        navigator.vibrate?.([100, 60, 100])
        // Med tallene kan man se HVOR meget der mangler og straks afgøre om det er
        // en tælefejl eller en rigtig afvigelse. På en blind tælling kommer de ikke med.
        setBesked({
          slags: 'advar',
          tekst:
            r.bcAntal === undefined
              ? `${aktiv.itemNo} stemmer IKKE — tæl varen om`
              : `${aktiv.itemNo}: du har talt ${tal(r.talt)}, BC har ${tal(r.bcAntal)} ` +
                `(${r.afvigelse > 0 ? '+' : ''}${tal(r.afvigelse)})`,
        })
      }
      setAktiv(null)
    } finally { setTravl(false) }
  }

  async function stemmer(itemNo: string) {
    if (!optaelling) return
    setTravl(true)
    try {
      const r = await fetch(`/api/lager/optaelling/${optaelling.id}/stemmer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemNo, idempotencyKey: nyNoegle() }),
      })
      const data = await r.json()
      if (!r.ok) { setBesked({ slags: 'advar', tekst: data.fejl ?? data.error ?? 'Kunne ikke bekræftes' }); return }
      bip(660, 120)
      setBesked({ slags: 'ok', tekst: `${itemNo} bekræftet uden optælling` })
      setAktiv(null)
      await hentStatus(optaelling.id)
    } finally { setTravl(false) }
  }

  async function fortryd(itemNo: string) {
    if (!optaelling) return
    await fetch(`/api/lager/optaelling/${optaelling.id}/linje?itemNo=${encodeURIComponent(itemNo)}`, { method: 'DELETE' })
    await hentStatus(optaelling.id)
    setAktiv(null)
  }

  async function send() {
    if (!optaelling) return
    setTravl(true)
    try {
      const r = await fetch(`/api/lager/optaelling/${optaelling.id}/send`, { method: 'POST' })
      const data = await r.json()
      if (!data.ok) { setBesked({ slags: 'fejl', tekst: data.fejl ?? 'Kunne ikke sendes' }); return }
      setBesked({
        slags: 'ok',
        tekst: `Sendt: ${data.linjer} varer, ${data.afvigelser} med afvigelse. Kladden ligger klar i BC.`,
      })
      await hentStatus(optaelling.id)
    } finally { setTravl(false) }
  }

  // ── Ingen tælling i gang ──────────────────────────────────────────────────
  if (!optaelling) {
    return (
      <div className="mx-auto max-w-lg px-4 py-4">
        <Link href="/lager" className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500">
          <ArrowLeft size={16} /> Tilbage
        </Link>
        <h1 className="mb-1 text-xl font-bold text-gray-900">Lageroptælling</h1>
        <p className="mb-4 text-sm text-gray-500">
          Du ser BC&apos;s tal mens du tæller, og afvigelsen med det samme. Vil du tælle uden at kende
          tallet, så slå blind tælling til.
        </p>

        <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-gray-200">
          <label className="block text-sm font-medium text-gray-700">Lokation</label>
          <select
            value={lokation}
            onChange={e => setLokation(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base"
          >
            {(mig?.lokationer ?? []).map((l: any) => (
              <option key={l.kode} value={l.kode}>{l.kode} — {l.navn}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setBlind(b => !b)}
            className="flex w-full items-center justify-between rounded-xl px-1 py-2 text-left"
          >
            <span>
              <span className="block text-sm font-medium text-gray-700">Blind tælling</span>
              <span className="block text-xs text-gray-500">Skjul BC&apos;s tal — du får kun at vide om det stemmer</span>
            </span>
            <span
              className={
                'ml-3 flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ' +
                (blind ? 'bg-gray-900' : 'bg-gray-300')
              }
            >
              <span className={'h-5 w-5 rounded-full bg-white transition ' + (blind ? 'translate-x-5' : '')} />
            </span>
          </button>

          <button
            onClick={start}
            disabled={travl || !lokation}
            className="w-full rounded-xl bg-emerald-700 py-3.5 font-semibold text-white disabled:opacity-40"
          >
            Start ny optælling
          </button>
        </div>

        {aabne.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Igangværende</h2>
            <ul className="space-y-2">
              {aabne.map(o => (
                <li key={o.id}>
                  <button
                    onClick={() => hentStatus(o.id)}
                    className="w-full rounded-2xl bg-white p-3 text-left ring-1 ring-gray-200"
                  >
                    <span className="font-semibold text-gray-900">{o.no}</span>
                    <span className="ml-2 text-sm text-gray-500">{o.locationCode} · {o.createdByName}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-gray-500">
              Flere kan tælle på den samme optælling — én mand pr. hylde, og appen lægger sammen.
            </p>
          </div>
        )}
      </div>
    )
  }

  // ── Tælling i gang ────────────────────────────────────────────────────────
  const laast = optaelling.status !== 'aaben'

  return (
    <div className="mx-auto max-w-lg px-4 pb-32 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{optaelling.no}</h1>
          <p className="text-sm text-gray-500">
            {optaelling.locationCode} · {varer.length} varer talt
            {optaelling.blind && ' · blind'}
          </p>
        </div>
        <Link href="/lager" className="text-sm text-gray-500">Luk</Link>
      </div>

      {laast ? (
        <div className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
          <p className="font-semibold text-emerald-900">Sendt til BC</p>
          <p className="mt-1 text-sm text-emerald-800">
            {optaelling.bcLinesWritten} linjer i lageropgørelseskladden, {optaelling.bcDiffLines} med afvigelse.
            Kladden skal bogføres i BC.
          </p>
        </div>
      ) : (
        <>
          {/* Hylde */}
          <div className="mb-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Layers size={14} /> Hylde
            </div>
            <div className="flex flex-wrap gap-2">
              {hylder.map(h => (
                <button
                  key={h.id}
                  onClick={() => setHylde(h.code)}
                  className={
                    'rounded-xl px-3 py-2 text-sm font-medium ring-1 ' +
                    (hylde === h.code
                      ? 'bg-gray-900 text-white ring-gray-900'
                      : 'bg-white text-gray-700 ring-gray-300')
                  }
                >
                  {h.code}
                </button>
              ))}
              <NyHylde
                lokation={optaelling.locationCode}
                onOprettet={h => { setHylder(h); }}
              />
            </div>
          </div>

          <ScanFelt onScan={scan} travl={travl} placeholder="Scan vare eller kasse" />

          {besked && (
            <p
              className={
                'mt-3 rounded-xl px-3 py-3 text-sm font-medium ' +
                (besked.slags === 'ok'
                  ? 'bg-emerald-50 text-emerald-800'
                  : besked.slags === 'advar'
                    ? 'bg-amber-50 text-amber-900'
                    : 'bg-red-50 text-red-800')
              }
            >
              {besked.slags === 'advar' && <AlertTriangle size={14} className="mr-1.5 inline" />}
              {besked.tekst}
            </p>
          )}

          {/* Den vare der tælles nu */}
          {aktiv && (
            <div className="mt-3 rounded-2xl bg-white p-4 ring-2 ring-emerald-600">
              <p className="font-semibold text-gray-900">{aktiv.itemNo} · {aktiv.navn}</p>
              <div className="mt-1 flex items-end gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Talt</p>
                  <p className="text-2xl font-bold tabular-nums text-emerald-700">
                    {tal(aktiv.total)} {aktiv.uom}
                  </p>
                </div>
                {aktiv.bcAntal !== null && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">BC</p>
                    <p
                      className={
                        'text-2xl font-bold tabular-nums ' +
                        (Math.abs(aktiv.total - aktiv.bcAntal) < 0.001 ? 'text-gray-400' : 'text-amber-600')
                      }
                    >
                      {tal(aktiv.bcAntal)}
                    </p>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500">{aktiv.antal} registrering(er) på denne tælling</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={faerdigMedVaren}
                  disabled={travl}
                  className="rounded-xl bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-40"
                >
                  <Check size={15} className="mr-1 inline" /> Færdig med varen
                </button>
                <button
                  onClick={() => setAnslaa(true)}
                  className="rounded-xl bg-white py-3 text-sm font-semibold text-gray-800 ring-1 ring-gray-300"
                >
                  <Pencil size={15} className="mr-1 inline" /> Anslå antal
                </button>
              </div>
              <button
                onClick={() => fortryd(aktiv.itemNo)}
                className="mt-2 w-full rounded-xl py-2 text-sm text-gray-500"
              >
                <Trash2 size={14} className="mr-1 inline" /> Fortryd sidste registrering
              </button>
            </div>
          )}

          {anslaa && aktiv && (
            <AnslaaAntal
              vare={aktiv}
              onLuk={() => setAnslaa(false)}
              onGemt={async (antal) => {
                setAnslaa(false)
                const res = await fetch(`/api/lager/optaelling/${optaelling.id}/linje`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    itemNo: aktiv.itemNo, description: aktiv.navn, qty: antal, uom: aktiv.uom,
                    estimated: true, shelfCode: hylde || undefined,
                    bcQty: aktiv.bcAntal ?? undefined, idempotencyKey: nyNoegle(),
                  }),
                })
                const data = await res.json()
                if (res.ok) {
                  bip(760, 100)
                  setAktiv({ ...aktiv, total: data.total, antal: data.antal })
                  await hentStatus(optaelling.id)
                }
              }}
            />
          )}
        </>
      )}

      {/* Talt indtil nu */}
      <ul className="mt-5 space-y-2">
        {varer.map(v => (
          <li key={v.itemNo} className="rounded-2xl bg-white p-3 ring-1 ring-gray-200">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">{v.itemNo} · {v.description}</p>
                <p className="text-sm text-gray-600">
                  <span className="font-semibold tabular-nums">{tal(v.total)} {v.uom}</span>
                  {v.bcAntal !== null && (
                    <span className="ml-2 text-gray-400">BC {tal(v.bcAntal)}</span>
                  )}
                  {v.afvigelse !== null && Math.abs(v.afvigelse) >= 0.001 && (
                    <span className="ml-2 font-semibold tabular-nums text-amber-700">
                      {v.afvigelse > 0 ? '+' : ''}{tal(v.afvigelse)}
                    </span>
                  )}
                  <span className="ml-2 text-gray-400">{v.antal} reg.</span>
                  {v.shelves && <span className="ml-2 text-gray-400">{v.shelves}</span>}
                </p>
                <p className="mt-0.5 flex gap-2 text-[11px] font-semibold uppercase">
                  {v.estimated && <span className="text-amber-700">anslået</span>}
                  {v.confirmed && <span className="text-sky-700">bekræftet, ikke talt</span>}
                </p>
              </div>
              {!laast && (
                <button onClick={() => fortryd(v.itemNo)} className="shrink-0 text-gray-300" aria-label="Fortryd">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Send */}
      {!laast && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-lg items-center gap-2">
            <StemmerKnap onVare={stemmer} />
            <button
              onClick={send}
              disabled={travl || varer.length === 0}
              className="flex-1 rounded-xl bg-gray-900 py-3.5 font-semibold text-white disabled:opacity-40"
            >
              <Send size={16} className="mr-1.5 inline" /> Send til BC ({varer.length})
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Tilføj en reol man står ved, uden at gå ind på kontoret først. */
function NyHylde({ lokation, onOprettet }: { lokation: string; onOprettet: (h: Hylde[]) => void }) {
  const [aaben, setAaben] = useState(false)
  const [kode, setKode] = useState('')
  const [navn, setNavn] = useState('')

  if (!aaben) {
    return (
      <button
        onClick={() => setAaben(true)}
        className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-gray-500 ring-1 ring-dashed ring-gray-300"
      >
        <Plus size={14} className="mr-1 inline" /> Ny hylde
      </button>
    )
  }

  return (
    <div className="w-full space-y-2 rounded-2xl bg-white p-3 ring-1 ring-gray-200">
      <input
        value={kode} onChange={e => setKode(e.target.value)} autoFocus placeholder="Kode, fx F1-A"
        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base"
      />
      <input
        value={navn} onChange={e => setNavn(e.target.value)} placeholder="Navn, fx Frys 1 reol A"
        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base"
      />
      <div className="flex gap-2">
        <button
          onClick={async () => {
            const h = await fetch('/api/lager/hylder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ locationCode: lokation, code: kode, name: navn }),
            }).then(r => r.json())
            onOprettet(h)
            setAaben(false)
            setKode(''); setNavn('')
          }}
          disabled={!kode.trim()}
          className="flex-1 rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Gem
        </button>
        <button onClick={() => setAaben(false)} className="rounded-xl px-4 py-2.5 text-sm text-gray-500">
          Fortryd
        </button>
      </div>
    </div>
  )
}

/** Der vejes ikke: ved tvivl anslår optælleren, og linjen mærkes ANSLÅET. */
function AnslaaAntal({
  vare, onLuk, onGemt,
}: {
  vare: { itemNo: string; navn: string; uom: string }
  onLuk: () => void
  onGemt: (antal: number) => void
}) {
  const [tekst, setTekst] = useState('')
  const antal = Number(tekst.replace(',', '.'))

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-t-3xl bg-white p-4">
        <h2 className="text-lg font-bold text-gray-900">Anslå antal</h2>
        <p className="mb-3 text-sm text-gray-500">
          {vare.itemNo} · {vare.navn} — i {vare.uom}. Linjen bliver mærket <strong>anslået</strong>, så
          kontoret kan se hvilke tal der er skøn.
        </p>
        <input
          value={tekst}
          onChange={e => setTekst(e.target.value)}
          autoFocus
          inputMode="decimal"
          placeholder="0"
          className="w-full rounded-xl border border-gray-300 px-3 py-4 text-center text-3xl font-bold tabular-nums"
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onGemt(antal)}
            disabled={!Number.isFinite(antal) || antal === 0}
            className="flex-1 rounded-xl bg-emerald-700 py-3.5 font-semibold text-white disabled:opacity-40"
          >
            <Hash size={16} className="mr-1.5 inline" /> Gem som anslået
          </button>
          <button onClick={onLuk} className="rounded-xl px-4 text-gray-500">Fortryd</button>
        </div>
      </div>
    </div>
  )
}

/** "Stemmer": godkend BC's tal på en vare uden at tælle den. */
function StemmerKnap({ onVare }: { onVare: (itemNo: string) => void }) {
  const [aaben, setAaben] = useState(false)
  const [nr, setNr] = useState('')

  if (!aaben) {
    return (
      <button
        onClick={() => setAaben(true)}
        className="rounded-xl bg-white px-3 py-3.5 text-sm font-semibold text-gray-800 ring-1 ring-gray-300"
      >
        <CircleCheck size={16} className="mr-1 inline" /> Stemmer
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-t-3xl bg-white p-4">
        <h2 className="text-lg font-bold text-gray-900">Stemmer</h2>
        <p className="mb-3 text-sm text-gray-500">
          Godkend BC&apos;s tal på en vare uden at tælle den. Den gemmes som <strong>bekræftet</strong>,
          ikke som talt — så man bagefter kan se forskel.
        </p>
        <input
          value={nr} onChange={e => setNr(e.target.value)} autoFocus placeholder="Varenr."
          className="w-full rounded-xl border border-gray-300 px-3 py-3.5 text-base font-mono uppercase"
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => { onVare(nr.trim().toUpperCase()); setAaben(false); setNr('') }}
            disabled={!nr.trim()}
            className="flex-1 rounded-xl bg-sky-700 py-3.5 font-semibold text-white disabled:opacity-40"
          >
            Bekræft varen
          </button>
          <button onClick={() => setAaben(false)} className="rounded-xl px-4 text-gray-500">Fortryd</button>
        </div>
      </div>
    </div>
  )
}
