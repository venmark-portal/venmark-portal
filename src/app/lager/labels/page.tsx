'use client'

// Print hylde-labels fra håndterminalen.
//
// Labelen tegnes og printes af BC (rapport 50650 → PrintNode). Skærmen vælger kun
// printer og antal. Derfor er en label printet ved hylden den samme som en printet på
// kontoret — layoutet findes ét sted.
//
// Kurven er med vilje: scanner man fem varer, skal de komme ud i ÉT print. Ét print pr.
// vare ville give fem A4-ark, hvor der var plads til tolv varer på det første.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Check, Minus, Plus, Printer, Trash2, X } from 'lucide-react'
import ScanFelt from '@/components/lager/ScanFelt'
import MeldTomHylde from '@/components/lager/MeldTomHylde'

interface PrinterRaekke { id: string; navn: string; beskrivelse: string }
interface Valg { printerId: string; printerNavn: string }
interface Vare { itemNo: string; navn: string; hylde: string; antal: number }

export default function LabelSide() {
  const [printere, setPrintere] = useState<PrinterRaekke[]>([])
  const [valg, setValg] = useState<Valg | null>(null)
  const [vaelger, setVaelger] = useState(false)
  const [varer, setVarer] = useState<Vare[]>([])
  const [travl, setTravl] = useState(false)
  const [besked, setBesked] = useState<{ slags: 'ok' | 'advar' | 'fejl'; tekst: string } | null>(null)
  // Scannede han kanban-QR'en på en label, han selv står med? Så er det tit netop
  // dér, man opdager at hylden er tom — mens man printer en ny label til den.
  const [tomHylde, setTomHylde] = useState<{ itemNo: string; navn: string } | null>(null)

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

  const hent = useCallback(async () => {
    const r = await fetch('/api/lager/print').then(x => x.json()).catch(() => null)
    if (!r) return
    setPrintere(r.printere ?? [])
    setValg(r.valg ?? null)
    // Ingen printer valgt endnu: så er det første skærmen skal spørge om. Uden en
    // printer er et tryk på "Print" et tryk der ikke kan virke.
    if (!r.valg && (r.printere ?? []).length > 0) setVaelger(true)
  }, [])

  useEffect(() => { hent() }, [hent])

  /** Slår koden op i BC for at få varenavnet. Labelen kan godt printes uden, men man
   *  skal kunne se HVAD man har scannet, før man sender fem ark gennem printeren. */
  async function scan(kode: string, kilde: 'kode' | 'kanban' = 'kode') {
    setTravl(true)
    setBesked(null)
    try {
      const r = await fetch('/api/lager/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: kode, context: 'label' }),
      })
      if (!r.ok) { bip(220, 250); setBesked({ slags: 'fejl', tekst: 'BC svarer ikke — prøv igen' }); return }
      const v = await r.json()
      if (!v.found) {
        bip(300, 200)
        navigator.vibrate?.(120)
        setBesked({
          slags: 'advar',
          tekst: `Ukendt kode ${kode}. Hylde-labelen er netop til varer UDEN stregkode — tast varenummeret i stedet.`,
        })
        return
      }
      bip(880, 80)
      setVarer(nu => {
        // Samme vare igen = én label mere, ikke en ny linje. Det er sådan man gør ved
        // hylden: man scanner til der er nok.
        const findes = nu.find(x => x.itemNo === v.itemNo)
        if (findes) return nu.map(x => (x.itemNo === v.itemNo ? { ...x, antal: x.antal + 1 } : x))
        return [...nu, { itemNo: v.itemNo, navn: v.description, hylde: v.shelfNo ?? '', antal: 1 }]
      })
      if (kilde === 'kanban') setTomHylde({ itemNo: v.itemNo, navn: v.description })
    } finally { setTravl(false) }
  }

  function saetAntal(itemNo: string, antal: number) {
    setVarer(nu =>
      antal <= 0
        ? nu.filter(x => x.itemNo !== itemNo)
        : nu.map(x => (x.itemNo === itemNo ? { ...x, antal } : x)),
    )
  }

  async function vaelgPrinter(p: PrinterRaekke) {
    const r = await fetch('/api/lager/print', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printerId: p.id, printerNavn: p.navn }),
    })
    const data = await r.json()
    if (!r.ok) { setBesked({ slags: 'advar', tekst: data.error ?? 'Printeren kunne ikke gemmes' }); return }
    setValg(data.valg)
    setVaelger(false)
  }

  /**
   * Printer alt i kurven. Antallet er pr. vare, så varer med forskelligt antal sendes
   * i hver sin portion — ellers ville "2 af den ene og 1 af den anden" blive 2 af begge.
   */
  async function print() {
    if (varer.length === 0) return
    setTravl(true)
    setBesked(null)
    try {
      // Grupperet som et almindeligt objekt og ikke et Map: tsconfig i dette repo
      // kører uden downlevelIteration, så et Map ikke kan gennemløbes direkte.
      const portioner: Record<string, string[]> = {}
      for (const v of varer) (portioner[String(v.antal)] ??= []).push(v.itemNo)

      let printet = 0
      let printer = ''
      for (const [antalTekst, itemNos] of Object.entries(portioner)) {
        const antal = Number(antalTekst)
        const r = await fetch('/api/lager/print', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemNos, antal }),
        })
        const data = await r.json()
        if (!r.ok) {
          bip(300, 300)
          if (data.vaelgPrinter) setVaelger(true)
          setBesked({ slags: 'advar', tekst: data.error ?? 'Der blev ikke printet noget' })
          return
        }
        printet += data.printet ?? 0
        printer = data.printer ?? printer
      }

      bip(1040, 120)
      setVarer([])
      setBesked({
        slags: 'ok',
        tekst: `${printet} label${printet === 1 ? '' : 's'} sendt til ${printer || valg?.printerNavn || 'printeren'}.`,
      })
    } finally { setTravl(false) }
  }

  const iAlt = varer.reduce((s, v) => s + v.antal, 0)

  return (
    <div className="mx-auto flex h-[100dvh] max-w-lg flex-col overflow-hidden">
      {/* pr-28: rolleskifteren svæver fast i øverste højre hjørne. */}
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pr-28 pt-3">
        <Link href="/lager" className="inline-flex items-center gap-1.5 text-sm text-gray-500">
          <ArrowLeft size={16} /> Tilbage
        </Link>
      </header>

      <div className="shrink-0 px-4">
        <h1 className="text-xl font-bold text-gray-900">Print hylde-label</h1>
        <button
          onClick={() => setVaelger(true)}
          className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-sm ring-1 ring-gray-300"
        >
          <Printer size={14} className="text-gray-500" />
          <span className={valg ? 'font-semibold text-gray-900' : 'text-amber-700'}>
            {valg?.printerNavn || 'Vælg printer'}
          </span>
        </button>

        <div className="mt-3">
          <ScanFelt onScan={scan} travl={travl} placeholder="Scan eller tast varenr." pause={vaelger || !!tomHylde} />
        </div>

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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 pt-3">
        {varer.length === 0 ? (
          <p className="mt-6 text-center text-sm text-gray-400">
            Scan eller tast de varer, der mangler en label. Hylde-labelen er til varer
            uden stregkode — emballage, tørvarer, rengøring, reservedele.
          </p>
        ) : (
          <ul className="space-y-2">
            {varer.map(v => (
              <li key={v.itemNo} className="rounded-2xl bg-white p-3 ring-1 ring-gray-200">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900">{v.navn || v.itemNo}</p>
                    <p className="text-xs text-gray-500">
                      {v.itemNo}
                      {v.hylde && <span className="ml-2 font-mono text-sky-700">{v.hylde}</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => saetAntal(v.itemNo, 0)}
                    className="shrink-0 p-1.5 text-gray-400"
                    aria-label="Fjern"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
                {/* Store tasteflader: antallet rettes med vante på. */}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => saetAntal(v.itemNo, v.antal - 1)}
                    className="rounded-xl bg-white px-4 py-2 ring-1 ring-gray-300"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="min-w-[4rem] text-center text-lg font-bold tabular-nums text-gray-900">
                    {v.antal}
                  </span>
                  <button
                    onClick={() => saetAntal(v.itemNo, v.antal + 1)}
                    className="rounded-xl bg-white px-4 py-2 ring-1 ring-gray-300"
                  >
                    <Plus size={16} />
                  </button>
                  <span className="text-sm text-gray-500">label{v.antal === 1 ? '' : 's'}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {vaelger && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setVaelger(false)}>
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-t-3xl bg-gray-100 p-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-1 flex shrink-0 items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Vælg printer</h2>
                <p className="text-xs text-gray-500">
                  Den huskes, indtil du vælger en anden — fx hvis du flytter sted.
                </p>
              </div>
              <button onClick={() => setVaelger(false)} className="shrink-0 rounded-full bg-white p-2 ring-1 ring-gray-300">
                <X size={18} />
              </button>
            </div>
            {printere.length === 0 && (
              // Ikke en tom liste uden forklaring: er der ingen printere, er det BC's
              // printerregister der er tomt, og så er det ikke appen der er i vejen.
              <p className="mt-2 rounded-xl bg-white p-3 text-sm text-gray-700 ring-1 ring-gray-200">
                BC har ingen printere registreret. Det er PrintNode-opsætningen i BC, der
                skal have dem — ikke appen.
              </p>
            )}
            <ul className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
              {printere.map(p => (
                <li key={p.id}>
                  <button
                    onClick={() => vaelgPrinter(p)}
                    className="flex w-full items-center justify-between gap-2 rounded-2xl bg-white p-3 text-left ring-1 ring-gray-200"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-gray-900">{p.navn}</span>
                      {p.beskrivelse && (
                        <span className="block truncate text-xs text-gray-500">{p.beskrivelse}</span>
                      )}
                    </span>
                    {valg?.printerId === p.id && <Check size={18} className="shrink-0 text-emerald-700" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <footer className="shrink-0 border-t border-gray-200 bg-white p-3">
        <button
          onClick={print}
          disabled={travl || varer.length === 0}
          className="w-full rounded-xl bg-sky-700 py-3.5 font-semibold text-white disabled:opacity-40"
        >
          <Printer size={16} className="mr-1.5 inline" />
          {travl ? 'Printer…' : `Print ${iAlt || ''} label${iAlt === 1 ? '' : 's'}`}
        </button>
      </footer>

      {tomHylde && (
        <MeldTomHylde
          itemNo={tomHylde.itemNo}
          navn={tomHylde.navn}
          onFaerdig={svar => {
            setTomHylde(null)
            if (svar) setBesked({ slags: svar.slags === 'ok' ? 'ok' : 'advar', tekst: svar.tekst })
          }}
        />
      )}
    </div>
  )
}
