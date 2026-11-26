'use client'

// Overfør stregkoder til BC fra håndterminalen.
//
// Vejen er VENDT OM i forhold til "Lær koden" på forsiden: dér står man med en ukendt
// kode og leder efter varen. Her står man med VAREN — man ved godt hvad det er, og
// skal give BC den stregkode, der sidder på kassen. Koden bliver en ægte varereference
// (BC cu 50652 LearnBarcode), så den virker overalt bagefter: pakkeri, salg, optælling.
//
// ÉT scannefelt, to trin. ScanFelt jagter fokus hvert 1,5 sekund, så to felter på samme
// skærm ville slås om scanneren, og tegnene ville lande i det forkerte felt.
//
// Ingen BC-ændring bag denne skærm: opslag, oprettelse og print findes allerede.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowLeft, Barcode, Check, CloudOff, Printer, RotateCcw, X,
} from 'lucide-react'
import ScanFelt from '@/components/lager/ScanFelt'
import PrinterValg, { type PrinterRaekke, type PrinterValgt } from '@/components/lager/PrinterValg'
import { laegIUdbakke } from '@/lib/lager/device'

interface Vare {
  itemNo: string
  navn: string
  hylde: string
  basisenhed: string
  gtin: string
}

/** Hvad BC siger om den kode, der ligger klar. Afgør om Godkend kan trykkes. */
type Kodeslags = 'fri' | 'optaget' | 'samme' | 'utjekket'

interface Gemt {
  id: string
  itemNo: string
  navn: string
  kode: string
  tekst: string
  slags: 'ok' | 'kø' | 'fejl'
}

/** Huskes pr. enhed: den der labeller en hel hylde skal ikke sætte flueben 30 gange. */
const PRINT_NOEGLE = 'lager-stregkode-print'

export default function StregkodeSide() {
  const [vare, setVare] = useState<Vare | null>(null)
  const [kode, setKode] = useState('')
  const [kodeslags, setKodeslags] = useState<Kodeslags>('fri')
  const [kodetekst, setKodetekst] = useState('')
  const [travl, setTravl] = useState(false)
  const [besked, setBesked] = useState<{ slags: 'ok' | 'advar' | 'fejl'; tekst: string } | null>(null)
  const [gemte, setGemte] = useState<Gemt[]>([])

  // Print: ét stk, uden at spørge om antal. Hylde-labelen findes i én udgave, og
  // skal man have to, trykker man to gange.
  const [printEfter, setPrintEfter] = useState(false)
  const [printere, setPrintere] = useState<PrinterRaekke[]>([])
  const [valg, setValg] = useState<PrinterValgt | null>(null)
  const [vaelger, setVaelger] = useState(false)

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
    } catch { /* lyd er pynt — scanning må aldrig fejle på den */ }
  }, [])

  useEffect(() => {
    try {
      setPrintEfter(localStorage.getItem(PRINT_NOEGLE) === '1')
    } catch { /* privat vindue — så bare uden */ }
    fetch('/api/lager/print')
      .then(r => r.json())
      .then(r => {
        setPrintere(r.printere ?? [])
        setValg(r.valg ?? null)
      })
      .catch(() => { /* print er tilvalg her — skærmen virker uden printer */ })
  }, [])

  function husPrintEfter(til: boolean) {
    setPrintEfter(til)
    try { localStorage.setItem(PRINT_NOEGLE, til ? '1' : '0') } catch { /* ingen */ }
  }

  /** Trin 1: hvilken vare? Trin 2: hvilken stregkode? Samme felt, samme scanner. */
  async function scan(raa: string, kilde: 'kode' | 'kanban' = 'kode') {
    if (!vare) return findVare(raa)
    return foreslaaKode(raa, kilde)
  }

  async function findVare(raa: string) {
    setTravl(true)
    setBesked(null)
    try {
      // Et opslag og ikke en ren Item.Get: scanner man kassen for at vælge varen,
      // skal en kode BC ALLEREDE kender også finde den.
      const r = await fetch('/api/lager/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: raa, context: 'stregkode' }),
      })
      if (!r.ok) {
        bip(220, 250)
        setBesked({ slags: 'fejl', tekst: 'BC svarer ikke — prøv igen' })
        return
      }
      const v = await r.json()
      if (!v.found) {
        bip(300, 200)
        navigator.vibrate?.(120)
        setBesked({ slags: 'advar', tekst: `Ingen vare på ${raa}. Tast varenummeret i stedet.` })
        return
      }
      bip(880, 80)
      setVare({
        itemNo: v.itemNo,
        navn: v.description ?? '',
        hylde: v.shelfNo ?? '',
        basisenhed: v.baseUnitOfMeasure ?? '',
        gtin: v.gtin ?? '',
      })
      nulstilKode()
    } finally { setTravl(false) }
  }

  function nulstilKode() {
    setKode('')
    setKodeslags('fri')
    setKodetekst('')
  }

  /**
   * Koden lægges KLAR — den gemmes først, når der er trykket Godkend. Derfor slår vi
   * den op først: at se "optaget af vare 48210" FØR man trykker er hele pointen med
   * en godkendelse. Trykker man alligevel, afviser BC den selv.
   */
  async function foreslaaKode(raa: string, kilde: 'kode' | 'kanban') {
    const ny = raa.trim().toUpperCase()
    if (!ny || !vare) return

    // Vores egen hylde-label inviterer til at blive scannet, og kanban-QR'en bliver
    // til varenummeret undervejs. Registrerede man DEN som stregkode, ville varens
    // eget nummer stå som en leverandørkode — og ingen ville kunne se hvorfor.
    if (kilde === 'kanban') {
      bip(300, 200)
      setBesked({
        slags: 'advar',
        tekst: 'Det er vores egen hylde-label (TOM HYLDE-koden) — ikke varens stregkode. Scan koden på kassen.',
      })
      return
    }
    if (ny === vare.itemNo) {
      bip(300, 200)
      setBesked({
        slags: 'advar',
        tekst: 'Det er varenummeret. BC finder det i forvejen — scan den stregkode, der sidder på kassen.',
      })
      return
    }

    setTravl(true)
    setBesked(null)
    setKode(ny)
    try {
      const r = await fetch('/api/lager/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: ny, context: 'stregkode' }),
      })
      if (!r.ok) {
        // Kan vi ikke tjekke, siger vi det. Koden kan stadig godkendes og lægges i
        // udbakken — BC afviser den, hvis den var optaget.
        bip(440, 120)
        setKodeslags('utjekket')
        setKodetekst('Kunne ikke tjekke koden — BC svarer ikke. Den kan godkendes og sendes senere.')
        return
      }
      const v = await r.json()
      if (!v.found) {
        bip(880, 80)
        setKodeslags('fri')
        setKodetekst('Koden er fri.')
        return
      }
      bip(300, 200)
      navigator.vibrate?.(120)
      if (v.itemNo === vare.itemNo) {
        setKodeslags('samme')
        setKodetekst('BC kender koden på denne vare i forvejen — der er ingenting at gemme.')
      } else {
        setKodeslags('optaget')
        setKodetekst(`Optaget af vare ${v.itemNo}${v.description ? ` (${v.description})` : ''}.`)
      }
    } finally { setTravl(false) }
  }

  /** Godkend: koden skrives til BC som en ægte varereference. */
  async function godkend() {
    if (!vare || !kode || kodeslags === 'optaget' || kodeslags === 'samme') return
    setTravl(true)
    setBesked(null)
    const krop = { barcode: kode, itemNo: vare.itemNo }
    const id = `${Date.now()}-${kode}`
    try {
      const r = await fetch('/api/lager/laer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...krop, idempotencyKey: `laer-${kode}-${vare.itemNo}` }),
      })
      const data = await r.json().catch(() => ({}))

      if (!r.ok || !data.created) {
        // Offline: læg den i udbakken i stedet for at tabe den på gulvet. Den sendes
        // af sig selv, når nettet er tilbage.
        if (r.status === 502 || !navigator.onLine) {
          await laegIUdbakke('/api/lager/laer', krop)
          bip(660, 120)
          log({ id, itemNo: vare.itemNo, navn: vare.navn, kode, slags: 'kø', tekst: 'I kø — sendes når der er net' })
          nulstilKode()
          return
        }
        bip(220, 250)
        const tekst = data.errorText || data.error || 'Koden kunne ikke oprettes'
        setBesked({ slags: 'advar', tekst })
        log({ id, itemNo: vare.itemNo, navn: vare.navn, kode, slags: 'fejl', tekst })
        return
      }

      bip(1040, 120)
      log({ id, itemNo: vare.itemNo, navn: vare.navn, kode, slags: 'ok', tekst: 'Gemt i BC' })
      nulstilKode()
      if (printEfter) await print(vare.itemNo, true)
    } finally { setTravl(false) }
  }

  function log(g: Gemt) {
    setGemte(l => [g, ...l].slice(0, 30))
  }

  /** Ét stk. hylde-label. Ingen antal-dialog: skal der to, trykker man to gange. */
  async function print(itemNo: string, stille = false) {
    if (!stille) setBesked(null)
    try {
      const r = await fetch('/api/lager/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemNos: [itemNo], antal: 1 }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        bip(300, 300)
        // Uden en printer kan et tryk på Print ikke virke — så er det det, skærmen
        // skal spørge om, og ikke en fejl man skal ringe om.
        if (data.vaelgPrinter) setVaelger(true)
        setBesked({ slags: 'advar', tekst: data.error ?? 'Der blev ikke printet noget' })
        return
      }
      setBesked({
        slags: 'ok',
        tekst: `1 label sendt til ${data.printer || valg?.printerNavn || 'printeren'}.`,
      })
    } catch {
      setBesked({ slags: 'advar', tekst: 'Printeren kunne ikke nås — er du offline?' })
    }
  }

  async function vaelgPrinter(p: PrinterRaekke) {
    const r = await fetch('/api/lager/print', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printerId: p.id, printerNavn: p.navn }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      setBesked({ slags: 'advar', tekst: data.error ?? 'Printeren kunne ikke gemmes' })
      return
    }
    setValg(data.valg)
    setVaelger(false)
  }

  const kanGodkende = !!vare && !!kode && !travl && kodeslags !== 'optaget' && kodeslags !== 'samme'

  return (
    <div className="mx-auto flex h-[100dvh] max-w-lg flex-col overflow-hidden">
      {/* pr-28: rolleskifteren svæver fast i øverste højre hjørne. */}
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pr-28 pt-3">
        <Link href="/lager" className="inline-flex items-center gap-1.5 text-sm text-gray-500">
          <ArrowLeft size={16} /> Tilbage
        </Link>
      </header>

      <div className="shrink-0 px-4">
        <h1 className="text-xl font-bold text-gray-900">Stregkoder til BC</h1>

        {/* Trin 1 — varen */}
        {vare ? (
          <div className="mt-2 rounded-2xl bg-white p-3 ring-1 ring-gray-200">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-gray-900">{vare.navn || vare.itemNo}</p>
                <p className="text-xs text-gray-500">
                  {vare.itemNo}
                  {vare.basisenhed && <span className="ml-2">{vare.basisenhed}</span>}
                  {vare.hylde && <span className="ml-2 font-mono text-sky-700">{vare.hylde}</span>}
                </p>
                {vare.gtin && <p className="mt-0.5 font-mono text-[11px] text-gray-400">GTIN {vare.gtin}</p>}
              </div>
              <button
                onClick={() => { setVare(null); nulstilKode(); setBesked(null) }}
                className="shrink-0 rounded-full bg-gray-100 p-2"
                aria-label="Vælg en anden vare"
              >
                <X size={16} />
              </button>
            </div>
            <button
              onClick={() => print(vare.itemNo)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-300"
            >
              <Printer size={14} className="text-gray-500" /> Print hylde-label (1 stk)
            </button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-gray-500">
            Tast varenummeret — eller scan en kode BC kender i forvejen.
          </p>
        )}

        {/* Scannefeltet skifter rolle, når varen er valgt. Ét felt, så scanneren altid
            afleverer i det rigtige. */}
        <div className="mt-3">
          <ScanFelt
            onScan={scan}
            travl={travl}
            taltastatur={!vare}
            pause={vaelger}
            placeholder={vare ? 'Scan stregkoden på kassen' : 'Tast eller scan varenr.'}
          />
        </div>

        {/* Trin 2 — koden ligger klar og skal godkendes */}
        {vare && kode && (
          <div
            className={
              'mt-2 rounded-2xl p-3 ring-1 ' +
              (kodeslags === 'fri'
                ? 'bg-emerald-50 ring-emerald-300'
                : kodeslags === 'utjekket'
                  ? 'bg-amber-50 ring-amber-300'
                  : 'bg-red-50 ring-red-300')
            }
          >
            <p className="flex items-center gap-2 font-mono text-lg font-bold tracking-wide text-gray-900">
              <Barcode size={18} className="shrink-0 text-gray-500" />
              {kode}
            </p>
            <p className="mt-0.5 text-sm text-gray-700">{kodetekst}</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={godkend}
                disabled={!kanGodkende}
                className="flex-1 rounded-xl bg-emerald-700 py-3 font-semibold text-white disabled:opacity-40"
              >
                <Check size={16} className="mr-1.5 inline" />
                {travl ? 'Gemmer…' : 'Godkend — gem i BC'}
              </button>
              <button
                onClick={nulstilKode}
                className="rounded-xl bg-white px-4 ring-1 ring-gray-300"
                aria-label="Fortryd koden"
              >
                <RotateCcw size={18} className="text-gray-500" />
              </button>
            </div>
          </div>
        )}

        {besked && (
          <p
            className={
              'mt-2 rounded-xl px-3 py-2 text-sm font-medium ' +
              (besked.slags === 'ok'
                ? 'bg-emerald-50 text-emerald-800'
                : besked.slags === 'advar'
                  ? 'bg-amber-50 text-amber-900'
                  : 'bg-red-50 text-red-800')
            }
          >
            {besked.slags !== 'ok' && <AlertTriangle size={14} className="mr-1.5 inline" />}
            {besked.tekst}
          </p>
        )}
      </div>

      {/* Hvad der er sendt til BC i denne omgang. Står man og tager en hel hylde, er
          det den eneste måde at se, at de forrige faktisk kom med. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 pt-3">
        {gemte.length === 0 ? (
          <p className="mt-4 text-center text-sm text-gray-400">
            Koden bliver en ægte varereference i BC — den virker bagefter i pakkeriet,
            på salg og ved optælling.
          </p>
        ) : (
          <ul className="space-y-2">
            {gemte.map(g => (
              <li
                key={g.id}
                className={
                  'rounded-2xl p-3 ring-1 ' +
                  (g.slags === 'ok'
                    ? 'bg-white ring-gray-200'
                    : g.slags === 'kø'
                      ? 'bg-amber-50 ring-amber-300'
                      : 'bg-red-50 ring-red-300')
                }
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">
                    {g.slags === 'ok' ? (
                      <Check size={16} className="text-emerald-600" />
                    ) : g.slags === 'kø' ? (
                      <CloudOff size={16} className="text-amber-600" />
                    ) : (
                      <AlertTriangle size={16} className="text-red-600" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">
                      {g.itemNo} · {g.navn}
                    </p>
                    <p className="font-mono text-sm text-gray-700">{g.kode}</p>
                    <p className="text-xs text-gray-500">{g.tekst}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="shrink-0 border-t border-gray-200 bg-white p-3">
        <label className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-gray-900">
              Print hylde-label efter godkendelse
            </span>
            <span className="block truncate text-xs text-gray-500">
              1 stk, uden at spørge · {valg?.printerNavn || 'ingen printer valgt'}
            </span>
          </span>
          <input
            type="checkbox"
            checked={printEfter}
            // Uden den tager fluebenet fokus fra scannefeltet, og så taster
            // terminalen ud i ingenting ved næste scan.
            onPointerDown={e => e.preventDefault()}
            onChange={e => husPrintEfter(e.target.checked)}
            className="h-6 w-6 shrink-0 rounded border-gray-300 text-emerald-700"
          />
        </label>
        <button
          onClick={() => setVaelger(true)}
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-500"
        >
          <Printer size={12} /> Skift printer
        </button>
      </footer>

      {vaelger && (
        <PrinterValg
          printere={printere}
          valg={valg}
          onVaelg={vaelgPrinter}
          onLuk={() => setVaelger(false)}
        />
      )}
    </div>
  )
}
