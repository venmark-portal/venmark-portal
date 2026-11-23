'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import {
  AlertTriangle, Check, ClipboardList, CloudOff, Database, LogOut, PackageSearch, Printer,
  RotateCcw, ShoppingCart, Tag, X,
} from 'lucide-react'
import ScanFelt from '@/components/lager/ScanFelt'
import OmAppen from '@/components/lager/OmAppen'
import MeldTomHylde from '@/components/lager/MeldTomHylde'
import {
  antalVarer, hentVare, laegIUdbakke, sendUdbakke, soegVarer, synkroniserKatalog, udbakkeAntal,
  type KatalogVare,
} from '@/lib/lager/device'

interface Scan {
  id: string
  kode: string
  tid: number
  status: 'ok' | 'ukendt' | 'fejl'
  varenr?: string
  navn?: string
  antal?: number
  enhed?: string
  lot?: string
  kodetype?: string
  vaegtvariabel?: boolean
  beholdning?: number
  spaerret?: boolean
  besked?: string
}

export default function LagerForside() {
  const [mig, setMig] = useState<any>(null)
  const [scanninger, setScanninger] = useState<Scan[]>([])
  // Kanban-QR'en fra hylde-labelen. Den virker på alle lager-skærme UNDTAGEN
  // bestillingen — dér fanger man alligevel, hvad der mangler (Claus 23-11).
  const [tomHylde, setTomHylde] = useState<{ itemNo: string; navn: string } | null>(null)
  const [travl, setTravl] = useState(false)
  const [katalog, setKatalog] = useState(0)
  const [kø, setKø] = useState(0)
  const [online, setOnline] = useState(true)
  const [laerKode, setLaerKode] = useState('')

  // Lyd: et kort bip er den eneste tilbagemelding man kan høre gennem høreværn.
  const lydRef = useRef<AudioContext | null>(null)
  const bip = useCallback((hz: number, ms: number) => {
    try {
      lydRef.current ??= new AudioContext()
      const ctx = lydRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = hz
      gain.gain.value = 0.08
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + ms / 1000)
    } catch {
      /* lyd er pynt — scanning må aldrig fejle på den */
    }
  }, [])

  useEffect(() => {
    fetch('/api/lager/me').then(r => r.json()).then(setMig).catch(() => {})
    synkroniserKatalog().then(() => antalVarer().then(setKatalog))
    udbakkeAntal().then(setKø)
    const opdater = () => setOnline(navigator.onLine)
    opdater()
    window.addEventListener('online', opdater)
    window.addEventListener('offline', opdater)
    return () => {
      window.removeEventListener('online', opdater)
      window.removeEventListener('offline', opdater)
    }
  }, [])

  // Kommer nettet tilbage, skal udbakken af sig selv — ingen skal huske at trykke send.
  useEffect(() => {
    if (!online || kø === 0) return
    sendUdbakke().then(r => setKø(r.tilbage))
  }, [online, kø])

  async function scan(kode: string, kilde: 'kode' | 'kanban' = 'kode') {
    setTravl(true)
    const id = `${Date.now()}-${kode}`

    // Vis straks hvad det offline-katalog tror, så skærmen ikke står tom imens.
    const gæt = await hentVare(kode.toUpperCase())
    if (gæt) {
      setScanninger(s => [
        { id, kode, tid: Date.now(), status: 'ok', varenr: gæt.nr, navn: gæt.navn, enhed: gæt.enhed, besked: 'slår op …' },
        ...s,
      ])
    }

    try {
      const res = await fetch('/api/lager/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: kode, locationCode: mig?.lokation ?? '', context: 'scan' }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        bip(220, 250)
        opdater(id, { id, kode, tid: Date.now(), status: 'fejl', besked: data.offline ? 'BC svarer ikke' : 'Fejl ved opslag' })
        return
      }

      const r = await res.json()
      if (!r.found) {
        bip(300, 200)
        navigator.vibrate?.(120)
        opdater(id, { id, kode, tid: Date.now(), status: 'ukendt', besked: r.errorText || 'Ukendt stregkode', kodetype: r.codeType })
        return
      }

      bip(880, 80)
      opdater(id, {
        id, kode, tid: Date.now(), status: 'ok',
        varenr: r.itemNo, navn: r.description, antal: r.quantity, enhed: r.unitOfMeasureCode,
        lot: r.lotNo, kodetype: r.codeType, vaegtvariabel: r.variableWeight,
        beholdning: r.inventory, spaerret: r.blocked,
      })
      if (kilde === 'kanban') setTomHylde({ itemNo: r.itemNo, navn: r.description })
    } finally {
      setTravl(false)
    }
  }

  function opdater(id: string, ny: Scan) {
    setScanninger(s => {
      const uden = s.filter(x => x.id !== id)
      return [ny, ...uden].slice(0, 50)
    })
  }

  function fortryd(id: string) {
    setScanninger(s => s.filter(x => x.id !== id))
  }

  return (
    // pt-12 giver plads til rolleskifteren, der svæver i øverste højre hjørne.
    <div className="mx-auto max-w-lg px-4 pb-24 pt-12">
      {/* Status — alt man skal kunne se med ét blik */}
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Lager</h1>
          <p className="text-sm text-gray-500">
            {mig?.navn ?? '…'}
            {mig?.lokation ? ` · ${mig.lokation}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs text-gray-500" title="Varer i offline-kataloget">
            <Database size={14} /> {katalog}
          </span>
          {kø > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
              <CloudOff size={13} /> {kø} i kø
            </span>
          )}
          {!online && (
            <span className="rounded-full bg-gray-900 px-2 py-1 text-xs font-medium text-white">Offline</span>
          )}
          <button onClick={() => signOut({ callbackUrl: '/lager/login' })} className="text-gray-400" aria-label="Log ud">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <ScanFelt onScan={scan} travl={travl} taltastatur pause={!!tomHylde} />

      <p className="mt-2 text-xs text-gray-500">
        Fri scanning: scan en kasse, en EAN eller et varenr. Ukendte koder kan knyttes til en vare med det samme.
      </p>

      <Link
        href="/lager/optaelling"
        className="mt-4 flex items-center justify-between rounded-2xl bg-gray-900 px-4 py-4 text-white"
      >
        <span>
          <span className="block font-semibold">Lageroptælling</span>
          <span className="block text-sm text-gray-300">Blind tælling pr. hylde — BC får totalen</span>
        </span>
        <ClipboardList size={22} />
      </Link>

      <Link
        href="/lager/bestilling"
        className="mt-2 flex items-center justify-between rounded-2xl bg-emerald-700 px-4 py-4 text-white"
      >
        <span>
          <span className="block font-semibold">Bestilling</span>
          <span className="block text-sm text-emerald-100">Scan hvad der mangler — BC laver købsordrerne</span>
        </span>
        <ShoppingCart size={22} />
      </Link>

      <Link
        href="/lager/labels"
        className="mt-2 flex items-center justify-between rounded-2xl bg-sky-700 px-4 py-4 text-white"
      >
        <span>
          <span className="block font-semibold">Print hylde-label</span>
          <span className="block text-sm text-sky-100">Scan varen — labelen kommer på din printer</span>
        </span>
        <Printer size={22} />
      </Link>

      <ul className="mt-4 space-y-2">
        {scanninger.map(s => (
          <li
            key={s.id}
            className={
              'rounded-2xl p-3 ring-1 ' +
              (s.status === 'ok'
                ? 'bg-white ring-gray-200'
                : s.status === 'ukendt'
                  ? 'bg-amber-50 ring-amber-300'
                  : 'bg-red-50 ring-red-300')
            }
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5">
                {s.status === 'ok' ? (
                  <Check size={18} className="text-emerald-600" />
                ) : s.status === 'ukendt' ? (
                  <PackageSearch size={18} className="text-amber-600" />
                ) : (
                  <AlertTriangle size={18} className="text-red-600" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                {s.status === 'ok' ? (
                  <>
                    <p className="truncate font-semibold text-gray-900">
                      {s.varenr} · {s.navn}
                    </p>
                    <p className="text-sm text-gray-600">
                      {s.antal !== undefined && (
                        <span className={s.vaegtvariabel ? 'font-semibold text-emerald-700' : ''}>
                          {s.antal?.toLocaleString('da-DK')} {s.enhed}
                        </span>
                      )}
                      {s.lot && <span className="ml-2 text-gray-500">lot {s.lot}</span>}
                      {s.beholdning !== undefined && (
                        <span className="ml-2 text-gray-400">BC: {s.beholdning.toLocaleString('da-DK')}</span>
                      )}
                    </p>
                    {s.spaerret && <p className="text-xs font-semibold text-red-700">Varen er spærret i BC</p>}
                    {s.besked && <p className="text-xs text-gray-400">{s.besked}</p>}
                  </>
                ) : (
                  <>
                    <p className="font-mono text-sm text-gray-900">{s.kode}</p>
                    <p className="text-sm text-gray-700">{s.besked}</p>
                    {s.status === 'ukendt' && (
                      <button
                        onClick={() => setLaerKode(s.kode)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-2 text-sm font-semibold text-white"
                      >
                        <Tag size={14} /> Lær koden
                      </button>
                    )}
                  </>
                )}
                <p className="mt-1 font-mono text-[11px] uppercase text-gray-400">
                  {s.kodetype} · {new Date(s.tid).toLocaleTimeString('da-DK')}
                </p>
              </div>

              <button onClick={() => fortryd(s.id)} className="text-gray-300" aria-label="Fjern fra listen">
                <RotateCcw size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <OmAppen />

      {laerKode && (
        <LaerKode
          kode={laerKode}
          onLuk={() => setLaerKode('')}
          onLaert={() => {
            setLaerKode('')
            bip(660, 120)
            udbakkeAntal().then(setKø)
          }}
        />
      )}

      {tomHylde && (
        <MeldTomHylde
          itemNo={tomHylde.itemNo}
          navn={tomHylde.navn}
          onFaerdig={svar => {
            setTomHylde(null)
            // Skærmen her har ingen beskedlinje — svaret lægger sig som en scanning
            // øverst i listen, hvor alt andet også lander.
            if (svar)
              opdater(`kanban-${Date.now()}`, {
                id:      `kanban-${Date.now()}`,
                kode:    tomHylde.itemNo,
                tid:     Date.now(),
                status:  svar.slags === 'ok' ? 'ok' : 'fejl',
                varenr:  tomHylde.itemNo,
                navn:    tomHylde.navn,
                besked:  svar.tekst,
              })
          }}
        />
      )}
    </div>
  )
}

/**
 * "Lær en stregkode": vælg varen, og koden bliver en ÆGTE varereference i BC — så den
 * virker overalt bagefter, også i pakkeriet og på salg. Søgningen kører i det offline
 * katalog, så den også virker i frostrummet.
 */
function LaerKode({ kode, onLuk, onLaert }: { kode: string; onLuk: () => void; onLaert: () => void }) {
  const [q, setQ] = useState('')
  const [fundet, setFundet] = useState<KatalogVare[]>([])
  const [travl, setTravl] = useState(false)
  const [fejl, setFejl] = useState('')

  useEffect(() => {
    let aktiv = true
    soegVarer(q).then(r => aktiv && setFundet(r))
    return () => { aktiv = false }
  }, [q])

  async function laer(vare: KatalogVare) {
    setTravl(true)
    setFejl('')
    try {
      const res = await fetch('/api/lager/laer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: kode, itemNo: vare.nr, idempotencyKey: `laer-${kode}-${vare.nr}` }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.created) {
        // Offline: læg den i udbakken i stedet for at tabe den på gulvet.
        if (res.status === 502 || !navigator.onLine) {
          await laegIUdbakke('/api/lager/laer', { barcode: kode, itemNo: vare.nr })
          onLaert()
          return
        }
        setFejl(data.errorText || data.error || 'Kunne ikke oprette koden')
        return
      }
      onLaert()
    } finally {
      setTravl(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40">
      <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Lær stregkode</h2>
            <p className="font-mono text-sm text-gray-500">{kode}</p>
          </div>
          <button onClick={onLuk} className="rounded-full bg-gray-100 p-2" aria-label="Luk">
            <X size={18} />
          </button>
        </div>

        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
          placeholder="Søg vare — navn eller nummer"
          className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base focus:border-emerald-600 focus:outline-none"
        />

        {fejl && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{fejl}</p>}

        <ul className="mt-3 space-y-1">
          {fundet.map(v => (
            <li key={v.nr}>
              <button
                disabled={travl}
                onClick={() => laer(v)}
                className="w-full rounded-xl px-3 py-3 text-left hover:bg-gray-50 disabled:opacity-40"
              >
                <span className="block font-semibold text-gray-900">{v.navn}</span>
                <span className="block text-sm text-gray-500">
                  {v.nr} · {v.enhed}
                  {v.gtin && ` · GTIN ${v.gtin}`}
                </span>
              </button>
            </li>
          ))}
          {q.length >= 2 && fundet.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-gray-500">Ingen varer matcher</li>
          )}
        </ul>
      </div>
    </div>
  )
}
