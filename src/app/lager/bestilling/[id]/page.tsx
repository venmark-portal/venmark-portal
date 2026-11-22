'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  AlertTriangle, ArrowLeft, Check, History, Inbox, Minus, Plus, Search, Send, StickyNote, Store,
  Trash2, X,
} from 'lucide-react'
import ScanFelt from '@/components/lager/ScanFelt'
import Bemaerkning from '@/components/lager/Bemaerkning'
import { nyNoegle, soegVarer, type KatalogVare } from '@/lib/lager/device'

// ─── Typer, som API'et svarer med ───────────────────────────────────────────

interface SidsteKoeb { dato: string; antal: number; leverandoer: string }

interface Opslag {
  found: boolean
  itemNo: string
  description: string
  baseUnitOfMeasure: string
  blocked: boolean
  inventory: number
  vendorNo: string
  vendorName: string
  vendorItemNo: string
  reorderQuantity: number
  unitsPerParcel: number
  shelfNo: string
  reorderPoint: number
  minimumOrderQuantity: number
  leadTime: string
  sidsteKoeb: SidsteKoeb[]
  errorText: string
}

interface Linje {
  id: string
  itemNo: string
  description: string
  qty: number
  uom: string
  vendorNo: string
  vendorName: string
  reorderQty: number | null
  remark: string
  scanCount: number
}

interface Gruppe { vendorNo: string; vendorName: string; linjer: Linje[] }

/** En "tom hylde"-melding fra kanban-QR'en på en hylde-label. */
interface Signal {
  id: string
  itemNo: string
  description: string
  baseUom: string
  antal: number
  firstAt: string
  meldtAf: string
}

interface Kurv {
  bestilling: {
    id: string; no: string; status: string; locationCode: string
    bcOrderNos: string | null; bcLines: number | null; bcFailed: number | null
  }
  grupper: Gruppe[]
  antalLinjer: number
  udenLeverandoer: number
}

/** Det senest scannede — panelet man retter antallet i. */
interface Sidste {
  opslag: Opslag
  qty: number
  tilfoejet: number
  fandtes: boolean
  scanCount: number
}

const nr = (n: number) => n.toLocaleString('da-DK', { maximumFractionDigits: 3 })

/**
 * Bestillingsskærmen. Scan hen over hylderne; appen foreslår varens ORDREKVANTUM som
 * antal, og BC deler op pr. leverandør når kurven sendes.
 *
 * Der er INGEN priser på denne skærm. Lagermanden bestiller efter hylden, og en pris på
 * en håndterminal er en pris alle ved rampen kan læse (Claus 22-11).
 */
export default function BestillingSkaerm() {
  const params = useParams<{ id: string }>()
  const id = String(params?.id ?? '')

  const [kurv, setKurv] = useState<Kurv | null>(null)
  const [signaler, setSignaler] = useState<Signal[]>([])
  const [sidste, setSidste] = useState<Sidste | null>(null)
  const [travl, setTravl] = useState(false)
  const [fejl, setFejl] = useState('')
  const [ukendt, setUkendt] = useState('')
  const [soeg, setSoeg] = useState(false)
  const [taster, setTaster] = useState<Linje | null>(null)
  const [noterer, setNoterer] = useState<Linje | null>(null)
  const [vaelgerLev, setVaelgerLev] = useState<Linje | null>(null)
  const [sender, setSender] = useState(false)
  const [sendt, setSendt] = useState<{ ordrer: number; ordreNumre: string; linjer: number; fejlede: number } | null>(null)

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

  const hent = useCallback(async () => {
    const res = await fetch(`/api/lager/bestilling/${id}`, { cache: 'no-store' })
    if (!res.ok) {
      setFejl('Bestillingen kunne ikke hentes')
      return
    }
    setKurv(await res.json())
  }, [id])

  const hentSignaler = useCallback(async () => {
    const res = await fetch('/api/lager/bestilling/kanban', { cache: 'no-store' })
    if (!res.ok) return
    const d = await res.json()
    setSignaler(d.signaler ?? [])
  }, [])

  useEffect(() => { hent(); hentSignaler() }, [hent, hentSignaler])

  const laast = kurv?.bestilling.status !== 'aaben'

  /** Scanner eller taster en kode i kurven. */
  async function scan(kode: string) {
    if (laast) { setFejl('Bestillingen er sendt til BC og kan ikke fyldes på'); return }
    setTravl(true)
    setFejl('')
    setUkendt('')
    try {
      const res = await fetch(`/api/lager/bestilling/${id}/linje`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kode, idempotencyKey: nyNoegle() }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        bip(220, 250)
        setFejl(data.error || (data.offline ? 'BC svarer ikke' : 'Fejl ved opslag'))
        return
      }
      if (!data.found) {
        bip(300, 200)
        navigator.vibrate?.(120)
        setUkendt(kode)
        return
      }

      bip(880, 80)
      setSidste({
        opslag: data.opslag,
        qty: data.linje.qty,
        tilfoejet: data.linje.tilfoejet,
        fandtes: data.linje.fandtes,
        scanCount: data.linje.scanCount,
      })
      await hent()
      // Er varen meldt tom, er der nu handlet på meldingen. Den lukkes uanset om man
      // kom fra listen eller scannede hylde-labelen — ellers bestiller to mand den
      // samme vare, fordi meldingen stadig står og lyser.
      await lukSignal(data.opslag.itemNo)
    } finally {
      setTravl(false)
    }
  }

  async function lukSignal(itemNo: string) {
    if (!signaler.some(s => s.itemNo === itemNo)) return
    await fetch('/api/lager/bestilling/kanban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemNo }),
    }).catch(() => {})
    await hentSignaler()
  }

  /** Retter en linje: antal, bemærkning eller leverandør. */
  async function ret(itemNo: string, aendring: Record<string, unknown>) {
    setTravl(true)
    try {
      const res = await fetch(`/api/lager/bestilling/${id}/linje`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemNo, ...aendring }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setFejl(d.error || 'Linjen kunne ikke rettes')
        return
      }
      await hent()
      // Panelet øverst skal følge med, ellers står der et gammelt antal på den vare
      // man netop har rettet.
      if (sidste?.opslag.itemNo === itemNo && typeof aendring.antal === 'number') {
        setSidste(s => (s ? { ...s, qty: aendring.antal as number } : s))
      }
    } finally {
      setTravl(false)
    }
  }

  async function fjern(itemNo: string) {
    setTravl(true)
    try {
      await fetch(`/api/lager/bestilling/${id}/linje?itemNo=${encodeURIComponent(itemNo)}`, { method: 'DELETE' })
      if (sidste?.opslag.itemNo === itemNo) setSidste(null)
      await hent()
    } finally {
      setTravl(false)
    }
  }

  async function send() {
    setSender(true)
    setFejl('')
    try {
      const res = await fetch(`/api/lager/bestilling/${id}/send`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFejl(data.error || 'Bestillingen kunne ikke sendes')
        return
      }
      bip(1046, 140)
      setSendt({
        ordrer: data.ordrer ?? 0,
        ordreNumre: data.ordreNumre ?? '',
        linjer: data.linjer ?? 0,
        fejlede: data.fejlede ?? 0,
      })
      await hent()
    } finally {
      setSender(false)
    }
  }

  if (sendt) return <Kvittering nr={kurv?.bestilling.no ?? ''} svar={sendt} />

  const dialogAaben = !!taster || !!noterer || !!vaelgerLev || soeg || !!ukendt

  return (
    <div className="mx-auto max-w-lg px-4 pb-32 pt-12">
      <header className="mb-3 flex items-center gap-3">
        <Link href="/lager/bestilling" className="rounded-full bg-white p-2 ring-1 ring-gray-200" aria-label="Tilbage">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900">{kurv?.bestilling.no ?? 'Bestilling'}</h1>
          <p className="text-sm text-gray-500">
            {kurv?.antalLinjer ?? 0} vare{(kurv?.antalLinjer ?? 0) === 1 ? '' : 'r'}
            {kurv && kurv.grupper.filter(g => g.vendorNo).length > 0 &&
              ` · ${kurv.grupper.filter(g => g.vendorNo).length} leverandør${kurv.grupper.filter(g => g.vendorNo).length === 1 ? '' : 'er'}`}
          </p>
        </div>
      </header>

      {laast && (
        <p className="mb-3 rounded-2xl bg-gray-900 px-3 py-3 text-sm text-white">
          Sendt til BC{kurv?.bestilling.bcOrderNos ? ` — købsordre ${kurv.bestilling.bcOrderNos}` : ''}.
          Kurven kan ikke fyldes på.
        </p>
      )}

      {!laast && <ScanFelt onScan={scan} travl={travl} taltastatur pause={dialogAaben} placeholder="Scan eller tast varenr." />}

      {!laast && (
        <button
          onClick={() => setSoeg(true)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-sm font-medium text-gray-600 ring-1 ring-gray-300"
        >
          <Search size={15} /> Søg varen frem
        </button>
      )}

      {fejl && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {fejl}
        </p>
      )}

      {/* "Tom hylde"-meldinger fra kanban-QR'en. Her er INGEN 90000-grænse, modsat
          salgsskærmen: kortene bruges mest over 90000, og netop de meldinger er
          indkøberens. Ét tryk lægger varen i kurven og lukker meldingen. */}
      {!laast && signaler.length > 0 && (
        <section className="mt-4 rounded-2xl bg-rose-50 p-3 ring-1 ring-rose-200">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-900">
            <Inbox size={15} /> Meldt tomt ({signaler.length})
          </h2>
          <ul className="space-y-1">
            {signaler.map(s => (
              <li key={s.id}>
                <button
                  onClick={() => scan(s.itemNo)}
                  disabled={travl}
                  className="flex w-full items-center justify-between gap-2 rounded-xl bg-white px-3 py-2.5 text-left ring-1 ring-rose-200 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-gray-900">
                      {s.description || s.itemNo}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {s.itemNo}
                      {s.antal > 1 && <span className="ml-2 font-semibold text-rose-700">{s.antal}×</span>}
                      <span className="ml-2">
                        {new Date(s.firstAt).toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit' })}
                        {s.meldtAf ? ` · ${s.meldtAf}` : ''}
                      </span>
                    </span>
                  </span>
                  <Plus size={18} className="shrink-0 text-rose-700" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Det senest scannede. Her står alt det man skal vide for at afgøre antallet:
          hvad der er på lageret, hvad genbestillingspunktet er, og hvad vi plejer at
          købe. */}
      {sidste && <SidstePanel s={sidste} onRet={n => ret(sidste.opslag.itemNo, { antal: n })} />}

      {/* Kurven, delt op pr. leverandør — det samme snit BC laver. */}
      {kurv?.grupper.map(g => (
        <section key={g.vendorNo || 'ingen'} className="mt-5">
          <h2
            className={
              'mb-2 flex items-center gap-2 text-sm font-semibold ' +
              (g.vendorNo ? 'text-gray-700' : 'text-amber-800')
            }
          >
            {g.vendorNo ? <Store size={15} /> : <AlertTriangle size={15} />}
            {g.vendorNo ? `${g.vendorName || g.vendorNo} → 1 købsordre` : 'Uden leverandør — kan ikke bestilles'}
            <span className="font-normal text-gray-400">({g.linjer.length})</span>
          </h2>
          <ul className="space-y-2">
            {g.linjer.map(l => (
              <li
                key={l.id}
                className={
                  'rounded-2xl p-3 ring-1 ' + (g.vendorNo ? 'bg-white ring-gray-200' : 'bg-amber-50 ring-amber-300')
                }
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-900">{l.description}</p>
                    <p className="text-sm text-gray-500">
                      {l.itemNo}
                      {l.scanCount > 1 && <span className="ml-2 text-gray-400">{l.scanCount} scan</span>}
                      {l.reorderQty !== null && l.qty !== l.reorderQty && (
                        <span className="ml-2 text-gray-400">ordrekvantum {nr(l.reorderQty)}</span>
                      )}
                    </p>
                    {l.remark && <p className="mt-1 text-sm italic text-gray-600">{l.remark}</p>}
                  </div>
                  <button
                    onClick={() => setTaster(l)}
                    disabled={laast}
                    className="shrink-0 rounded-xl bg-gray-900 px-3 py-2 text-right font-mono text-lg font-semibold text-white disabled:opacity-40"
                    aria-label={`Ret antal på ${l.description}`}
                  >
                    {nr(l.qty)}
                    <span className="ml-1 text-xs font-normal text-gray-300">{l.uom}</span>
                  </button>
                </div>

                {!laast && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      onClick={() => ret(l.itemNo, { antal: Math.max(0, l.qty - (l.reorderQty || 1)) })}
                      className="rounded-lg bg-gray-100 p-2 text-gray-700"
                      aria-label="Færre"
                    >
                      <Minus size={15} />
                    </button>
                    <button
                      onClick={() => ret(l.itemNo, { antal: l.qty + (l.reorderQty || 1) })}
                      className="rounded-lg bg-gray-100 p-2 text-gray-700"
                      aria-label="Flere"
                    >
                      <Plus size={15} />
                    </button>
                    <button
                      onClick={() => setNoterer(l)}
                      className={
                        'rounded-lg p-2 ' + (l.remark ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700')
                      }
                      aria-label="Bemærkning"
                    >
                      <StickyNote size={15} />
                    </button>
                    <button
                      onClick={() => setVaelgerLev(l)}
                      className={
                        'rounded-lg p-2 ' + (l.vendorNo ? 'bg-gray-100 text-gray-700' : 'bg-amber-600 text-white')
                      }
                      aria-label="Vælg leverandør"
                    >
                      <Store size={15} />
                    </button>
                    <button
                      onClick={() => fjern(l.itemNo)}
                      className="ml-auto rounded-lg bg-gray-100 p-2 text-gray-500"
                      aria-label="Tag ud af kurven"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {kurv && kurv.antalLinjer === 0 && !laast && (
        <p className="mt-10 text-center text-sm text-gray-400">
          Kurven er tom. Scan det der mangler på hylderne.
        </p>
      )}

      {/* Send-knappen ligger fast nederst: den skal kunne nås med en tommelfinger,
          uanset hvor langt kurven er rullet. */}
      {!laast && (kurv?.antalLinjer ?? 0) > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 p-3 backdrop-blur">
          <div className="mx-auto max-w-lg">
            {(kurv?.udenLeverandoer ?? 0) > 0 && (
              <p className="mb-2 text-center text-xs font-semibold text-amber-800">
                {kurv?.udenLeverandoer} vare(r) mangler en leverandør og kommer ikke på en ordre
              </p>
            )}
            <button
              onClick={send}
              disabled={sender}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 py-4 font-semibold text-white disabled:opacity-50"
            >
              <Send size={18} />
              {sender
                ? 'Sender til BC …'
                : `Send til BC — ${kurv?.grupper.filter(g => g.vendorNo).length ?? 0} købsordre${(kurv?.grupper.filter(g => g.vendorNo).length ?? 0) === 1 ? '' : 'r'}`}
            </button>
            <p className="mt-1.5 text-center text-[11px] text-gray-500">
              Ordrerne oprettes ÅBNE i BC. Der sendes ikke noget til leverandøren.
            </p>
          </div>
        </div>
      )}

      {/* ── Dialoger ──────────────────────────────────────────────────────── */}

      {ukendt && (
        <UkendtKode
          kode={ukendt}
          onLuk={() => setUkendt('')}
          onVare={v => { setUkendt(''); scan(v) }}
        />
      )}

      {soeg && (
        <SoegVare
          onLuk={() => setSoeg(false)}
          onVare={v => { setSoeg(false); scan(v) }}
        />
      )}

      {taster && (
        <SaetAntal
          linje={taster}
          onLuk={() => setTaster(null)}
          onGem={n => { setTaster(null); ret(taster.itemNo, { antal: n }) }}
        />
      )}

      {noterer && (
        <Bemaerkning
          vare={`${noterer.itemNo} · ${noterer.description}`}
          start={noterer.remark}
          onLuk={() => setNoterer(null)}
          onGem={t => { setNoterer(null); ret(noterer.itemNo, { bemaerkning: t }) }}
        />
      )}

      {vaelgerLev && (
        <VaelgLeverandoer
          linje={vaelgerLev}
          onLuk={() => setVaelgerLev(null)}
          onValgt={(nummer, navn) => {
            setVaelgerLev(null)
            ret(vaelgerLev.itemNo, { vendorNo: nummer, vendorName: navn })
          }}
        />
      )}
    </div>
  )
}

/**
 * Det senest scannede. Det vigtigste her er de TRE SIDSTE KØB: det er dem der afgør om
 * 24 stk. er det rigtige antal, eller om vi altid køber 100. Et tal fra varekortet
 * alene fortæller ikke hvad vi faktisk plejer at gøre.
 */
function SidstePanel({ s, onRet }: { s: Sidste; onRet: (n: number) => void }) {
  const o = s.opslag
  const trin = o.reorderQuantity > 0 ? o.reorderQuantity : 1
  return (
    <div className="mt-4 rounded-2xl bg-white p-4 ring-2 ring-emerald-600">
      <div className="flex items-start gap-3">
        <Check size={20} className="mt-0.5 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900">{o.description}</p>
          <p className="text-sm text-gray-500">
            {o.itemNo}
            {o.shelfNo && <span className="ml-2">hylde {o.shelfNo}</span>}
          </p>
          <p className="mt-0.5 text-sm text-gray-600">
            {o.vendorName || o.vendorNo || <span className="font-semibold text-amber-700">ingen leverandør</span>}
            {o.vendorItemNo && <span className="ml-2 text-gray-400">deres nr. {o.vendorItemNo}</span>}
            {o.leadTime && <span className="ml-2 text-gray-400">{o.leadTime}</span>}
          </p>
          {o.blocked && <p className="text-sm font-semibold text-red-700">Varen er SPÆRRET i BC</p>}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => onRet(Math.max(0, s.qty - trin))} className="rounded-xl bg-gray-100 p-3" aria-label="Færre">
          <Minus size={18} />
        </button>
        <div className="flex-1 text-center">
          <span className="font-mono text-3xl font-bold text-gray-900">{nr(s.qty)}</span>
          <span className="ml-1 text-sm text-gray-500">{o.baseUnitOfMeasure}</span>
          <p className="text-xs text-gray-400">
            {s.fandtes
              ? `lagde ${nr(s.tilfoejet)} til · ${s.scanCount}. scan`
              : o.reorderQuantity > 0
                ? `forslag = ordrekvantum ${nr(o.reorderQuantity)}`
                : 'intet ordrekvantum i BC'}
          </p>
        </div>
        <button onClick={() => onRet(s.qty + trin)} className="rounded-xl bg-gray-100 p-3" aria-label="Flere">
          <Plus size={18} />
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Tal navn="På lager" vaerdi={nr(o.inventory)} />
        <Tal navn="Genbestil ved" vaerdi={o.reorderPoint > 0 ? nr(o.reorderPoint) : '—'} />
        <Tal navn="Pr. kolli" vaerdi={o.unitsPerParcel > 0 ? nr(o.unitsPerParcel) : '—'} />
      </dl>
      {o.reorderPoint > 0 && o.inventory <= o.reorderPoint && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          Beholdningen er på eller under genbestillingspunktet.
        </p>
      )}
      {o.minimumOrderQuantity > 0 && s.qty < o.minimumOrderQuantity && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          Leverandøren kræver mindst {nr(o.minimumOrderQuantity)} {o.baseUnitOfMeasure}.
        </p>
      )}

      <div className="mt-3 border-t border-gray-100 pt-2">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <History size={13} /> Sidste køb
        </p>
        {o.sidsteKoeb.length === 0 ? (
          <p className="text-sm text-gray-400">Ingen køb de sidste tre år</p>
        ) : (
          <ul className="space-y-0.5">
            {o.sidsteKoeb.map(k => (
              <li key={k.dato + k.leverandoer} className="flex justify-between text-sm">
                <span className="text-gray-500">
                  {new Date(k.dato).toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  <span className="ml-2 text-gray-400">{k.leverandoer}</span>
                </span>
                <span className="font-mono font-semibold text-gray-900">
                  {nr(k.antal)} {o.baseUnitOfMeasure}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Tal({ navn, vaerdi }: { navn: string; vaerdi: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{navn}</dt>
      <dd className="font-mono text-base font-semibold text-gray-900">{vaerdi}</dd>
    </div>
  )
}

/** Taltastatur til at SÆTTE antallet. 0 tager varen ud af kurven. */
function SaetAntal({ linje, onLuk, onGem }: { linje: Linje; onLuk: () => void; onGem: (n: number) => void }) {
  const [tekst, setTekst] = useState('')
  const vis = tekst === '' ? nr(linje.qty) : tekst

  function tryk(t: string) {
    if (t === 'slet') { setTekst(s => s.slice(0, -1)); return }
    if (t === ',') { setTekst(s => (s.includes(',') ? s : (s || '0') + ',')); return }
    setTekst(s => (s + t).slice(0, 9))
  }

  function gem() {
    const n = tekst === '' ? linje.qty : Number(tekst.replace(',', '.'))
    if (!Number.isFinite(n)) return
    onGem(n)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-t-3xl bg-white p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900">Antal</h2>
            <p className="truncate text-sm text-gray-500">{linje.itemNo} · {linje.description}</p>
          </div>
          <button onClick={onLuk} className="rounded-full bg-gray-100 p-2" aria-label="Luk">
            <X size={18} />
          </button>
        </div>

        <p className="rounded-xl bg-gray-50 py-4 text-center font-mono text-4xl font-bold text-gray-900">
          {vis} <span className="text-base font-normal text-gray-500">{linje.uom}</span>
        </p>
        <p className="mt-1 text-center text-xs text-gray-400">0 tager varen ud af kurven</p>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', 'slet'].map(t => (
            <button
              key={t}
              type="button"
              onClick={() => tryk(t)}
              className={
                'rounded-xl py-4 text-2xl font-semibold ' +
                (t === 'slet' ? 'bg-gray-200 text-gray-700' : 'bg-white text-gray-900 ring-1 ring-gray-300 active:bg-gray-100')
              }
            >
              {t === 'slet' ? '←' : t}
            </button>
          ))}
        </div>

        <button onClick={gem} className="mt-3 w-full rounded-xl bg-emerald-700 py-4 font-semibold text-white">
          Gem antal
        </button>
      </div>
    </div>
  )
}

/**
 * Varesøgning i det OFFLINE katalog. Samme katalog lager-appen bruger, så den også
 * virker i frostrummet — og serveren slår varen op bagefter, så det er stadig BC der
 * bestemmer hvad varen er.
 */
function SoegVare({ onLuk, onVare }: { onLuk: () => void; onVare: (varenr: string) => void }) {
  const [q, setQ] = useState('')
  const [fundet, setFundet] = useState<KatalogVare[]>([])

  useEffect(() => {
    let aktiv = true
    soegVarer(q).then(r => aktiv && setFundet(r))
    return () => { aktiv = false }
  }, [q])

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40">
      <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Søg vare</h2>
          <button onClick={onLuk} className="rounded-full bg-gray-100 p-2" aria-label="Luk">
            <X size={18} />
          </button>
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
          placeholder="Navn eller varenummer"
          className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base focus:border-emerald-600 focus:outline-none"
        />
        <ul className="mt-3 space-y-1">
          {fundet.map(v => (
            <li key={v.nr}>
              <button onClick={() => onVare(v.nr)} className="w-full rounded-xl px-3 py-3 text-left hover:bg-gray-50">
                <span className="block font-semibold text-gray-900">{v.navn}</span>
                <span className="block text-sm text-gray-500">{v.nr} · {v.enhed}</span>
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

/**
 * En kode BC ikke kender. Her LÆRER vi den ikke — det hører i lager-appen, hvor man
 * har hylden foran sig. Her vælger man bare varen, så bestillingen kan komme videre.
 */
function UkendtKode({ kode, onLuk, onVare }: { kode: string; onLuk: () => void; onVare: (varenr: string) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40">
      <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Koden kendes ikke</h2>
            <p className="font-mono text-sm text-gray-500">{kode}</p>
          </div>
          <button onClick={onLuk} className="rounded-full bg-gray-100 p-2" aria-label="Luk">
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 text-sm text-gray-600">
          Søg varen frem i stedet. Vil du knytte koden til varen for altid, gør du det
          under fri scanning i lager-appen.
        </p>
        <SoegIndhold onVare={onVare} />
      </div>
    </div>
  )
}

function SoegIndhold({ onVare }: { onVare: (varenr: string) => void }) {
  const [q, setQ] = useState('')
  const [fundet, setFundet] = useState<KatalogVare[]>([])

  useEffect(() => {
    let aktiv = true
    soegVarer(q).then(r => aktiv && setFundet(r))
    return () => { aktiv = false }
  }, [q])

  return (
    <>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        autoFocus
        placeholder="Navn eller varenummer"
        className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base focus:border-emerald-600 focus:outline-none"
      />
      <ul className="mt-3 space-y-1">
        {fundet.map(v => (
          <li key={v.nr}>
            <button onClick={() => onVare(v.nr)} className="w-full rounded-xl px-3 py-3 text-left hover:bg-gray-50">
              <span className="block font-semibold text-gray-900">{v.navn}</span>
              <span className="block text-sm text-gray-500">{v.nr} · {v.enhed}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * Leverandør på en linje. Nødvendig når varekortet ikke har en: uden den stod
 * lagermanden med en kurv BC afviser, og ingen vej videre end at ringe til kontoret.
 */
function VaelgLeverandoer({
  linje, onLuk, onValgt,
}: {
  linje: Linje
  onLuk: () => void
  onValgt: (nummer: string, navn: string) => void
}) {
  const [q, setQ] = useState('')
  const [fundet, setFundet] = useState<{ nr: string; navn: string }[]>([])
  const [henter, setHenter] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) { setFundet([]); return }
    let aktiv = true
    setHenter(true)
    const t = setTimeout(() => {
      fetch(`/api/lager/bestilling/leverandorer?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })
        .then(r => r.json())
        .then(d => aktiv && setFundet(d.leverandoerer ?? []))
        .catch(() => aktiv && setFundet([]))
        .finally(() => aktiv && setHenter(false))
    }, 300)
    return () => { aktiv = false; clearTimeout(t) }
  }, [q])

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40">
      <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900">Leverandør</h2>
            <p className="truncate text-sm text-gray-500">{linje.itemNo} · {linje.description}</p>
          </div>
          <button onClick={onLuk} className="rounded-full bg-gray-100 p-2" aria-label="Luk">
            <X size={18} />
          </button>
        </div>
        {linje.vendorNo && (
          <p className="mb-2 text-sm text-gray-600">Nu: {linje.vendorName || linje.vendorNo}</p>
        )}
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
          placeholder="Søg leverandør — navn eller nummer"
          className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base focus:border-emerald-600 focus:outline-none"
        />
        {henter && <p className="mt-3 text-sm text-gray-400">Søger …</p>}
        <ul className="mt-3 space-y-1">
          {fundet.map(v => (
            <li key={v.nr}>
              <button
                onClick={() => onValgt(v.nr, v.navn)}
                className="w-full rounded-xl px-3 py-3 text-left hover:bg-gray-50"
              >
                <span className="block font-semibold text-gray-900">{v.navn}</span>
                <span className="block text-sm text-gray-500">{v.nr}</span>
              </button>
            </li>
          ))}
          {!henter && q.trim().length >= 2 && fundet.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-gray-500">Ingen leverandører matcher</li>
          )}
        </ul>
      </div>
    </div>
  )
}

/** Kvitteringen. Ordrenumrene skal kunne læses højt til kontoret uden at åbne BC. */
function Kvittering({
  nr: nummer,
  svar,
}: {
  nr: string
  svar: { ordrer: number; ordreNumre: string; linjer: number; fejlede: number }
}) {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <Check size={56} className="text-emerald-600" />
      <h1 className="mt-3 text-2xl font-bold text-gray-900">{nummer} er sendt</h1>
      <p className="mt-1 text-gray-600">
        {svar.linjer} linje{svar.linjer === 1 ? '' : 'r'} på {svar.ordrer} købsordre
        {svar.ordrer === 1 ? '' : 'r'}
      </p>
      {svar.ordreNumre && (
        <p className="mt-3 rounded-2xl bg-white px-4 py-3 font-mono text-lg font-semibold text-gray-900 ring-1 ring-gray-200">
          {svar.ordreNumre}
        </p>
      )}
      {svar.fejlede > 0 && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          {svar.fejlede} linje(r) kom ikke på en ordre. Kontoret kan se hvorfor på
          bestillingen i BC.
        </p>
      )}
      <p className="mt-4 text-sm text-gray-500">
        Ordrerne ligger ÅBNE i BC og skal godkendes og sendes af kontoret.
      </p>
      <div className="mt-6 flex w-full flex-col gap-2">
        <Link
          href="/lager/bestilling"
          className="rounded-2xl bg-emerald-700 py-4 font-semibold text-white"
        >
          Ny bestilling
        </Link>
        <Link href="/lager" className="rounded-2xl bg-white py-4 font-semibold text-gray-700 ring-1 ring-gray-300">
          Tilbage til lager
        </Link>
      </div>
    </div>
  )
}
