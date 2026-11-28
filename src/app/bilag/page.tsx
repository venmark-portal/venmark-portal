'use client'

// Udlæg/bilag: tag billede af kvitteringen → felterne forudfyldes → vælg betaling og konto →
// send. Portalen laver PDF'en og mailer den til bilagsmailen (→ Expense720). Se lib/udlaeg.ts.

import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Loader2, Receipt, Trash2, AlertTriangle } from 'lucide-react'

interface Konto { kontoNr: string; tekst: string; forklaring: string; repraesentation: boolean }
interface Kort { kode: string; beskrivelse: string }
interface Opsaetning {
  tilladt: boolean
  fejl?: string
  bruger?: { navn: string; vendorNo: string }
  konti?: Konto[]
  kort?: Kort[]
  klar?: boolean
  aflaesning?: boolean
}

const VED_IKKE = '__ved_ikke__'
const VALUTAER = ['DKK', 'EUR', 'SEK', 'NOK', 'GBP', 'USD']

function idag(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Skalerer billedet ned (max 1800 px) og gemmer som JPEG — et telefonfoto er ellers 4-8 MB. */
function komprimer(fil: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fil)
    const img = new Image()
    img.onload = () => {
      const max = 1800
      const s = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s)
      c.height = Math.round(img.height * s)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Billedet kunne ikke læses')) }
    img.src = url
  })
}

/** "1.234,56" og "1234,56" (dansk) samt "1234.56" (punktum som decimal) → 1234.56 */
function tilTal(s: string): number {
  const t = String(s).replace(/\s/g, '')
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'))
  return /^\d+\.\d{1,2}$/.test(t) ? Number(t) : Number(t.replace(/\./g, ''))
}
const fraTal = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export default function BilagSide() {
  const [ops, setOps] = useState<Opsaetning | null>(null)
  const [billeder, setBilleder] = useState<string[]>([])
  const [aflaeser, setAflaeser] = useState(false)
  const [dato, setDato] = useState(idag())
  const [butik, setButik] = useState('')
  const [cvr, setCvr] = useState('')
  const [beloeb, setBeloeb] = useState('')
  const [moms, setMoms] = useState('')
  const [valuta, setValuta] = useState('DKK')
  const [kortKode, setKortKode] = useState('')        // '' = privat udlæg
  const [konto, setKonto] = useState('')              // kontonr. eller VED_IKKE
  const [formaal, setFormaal] = useState('')
  const [deltagere, setDeltagere] = useState('')
  const [sender, setSender] = useState(false)
  const [fejl, setFejl] = useState('')
  const [dublet, setDublet] = useState<{ bilagId: string; merchant: string }[] | null>(null)
  const [sendt, setSendt] = useState<string | null>(null)
  const filRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/bilag/opsaetning').then(r => r.json()).then(setOps)
      .catch(() => setOps({ tilladt: false, fejl: 'Kunne ikke hente opsætningen. Prøv igen.' }))
  }, [])

  const valgtKonto = ops?.konti?.find(k => k.kontoNr === konto)

  async function tilfoejBilleder(filer: FileList | null) {
    if (!filer?.length) return
    setFejl('')
    const nye: string[] = []
    for (const f of Array.from(filer)) {
      try { nye.push(await komprimer(f)) } catch (e: any) { setFejl(e.message) }
    }
    if (!nye.length) return
    const alle = [...billeder, ...nye]
    setBilleder(alle)
    // Første billede(r): lad AI'en foreslå felterne — men overskriv aldrig noget man har tastet.
    if (billeder.length === 0 && ops?.aflaesning) {
      setAflaeser(true)
      try {
        const r = await fetch('/api/bilag/aflaes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ billeder: alle }),
        }).then(x => x.json())
        if (r.dato) setDato(d => (d === idag() ? r.dato : d))
        if (r.butik) setButik(v => v || r.butik)
        if (r.cvr) setCvr(v => v || r.cvr)
        if (r.beloeb != null) setBeloeb(v => v || fraTal(r.beloeb))
        if (r.moms != null) setMoms(v => v || fraTal(r.moms))
        if (r.valuta && VALUTAER.includes(r.valuta)) setValuta(r.valuta)
      } catch { /* kun en hjælp */ }
      setAflaeser(false)
    }
  }

  async function send(bekraeftDublet = false) {
    setFejl('')
    if (!konto) { setFejl('Vælg hvad udgiften er — eller "Ved ikke".'); return }
    setSender(true)
    try {
      const res = await fetch('/api/bilag/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billeder, dato, butik, cvr, valuta, formaal, deltagere, kortKode, bekraeftDublet,
          beloeb: tilTal(beloeb), moms: moms ? tilTal(moms) : 0,
          kontoNr: konto === VED_IKKE ? '' : konto,
        }),
      })
      const r = await res.json().catch(() => ({}))
      if (res.status === 409 && r.dublet) { setDublet(r.dublet); return }
      if (!res.ok || !r.ok) { setFejl(r.fejl || 'Bilaget kunne ikke sendes. Prøv igen.'); return }
      setDublet(null)
      setSendt(r.bilagId)
    } catch {
      setFejl('Ingen forbindelse. Prøv igen, når du har net.')
    } finally {
      setSender(false)
    }
  }

  function nytBilag() {
    setBilleder([]); setDato(idag()); setButik(''); setCvr(''); setBeloeb(''); setMoms(''); setValuta('DKK')
    setKonto(''); setFormaal(''); setDeltagere(''); setFejl(''); setDublet(null); setSendt(null)
  }

  if (!ops) return <Midte><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></Midte>

  if (!ops.tilladt) return (
    <Midte>
      <Receipt className="mx-auto mb-3 h-10 w-10 text-gray-300" />
      <p className="font-semibold text-gray-800">{ops.fejl ?? 'Du har ikke adgang til bilag.'}</p>
      {!ops.fejl && <p className="mt-1 text-sm text-gray-500">Bogholderiet skal sætte &quot;Bilag tilladt&quot; og din login-e-mail på dit kreditorkort i BC.</p>}
    </Midte>
  )

  if (sendt) return (
    <Midte>
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
        <Check className="h-8 w-8 text-emerald-600" />
      </div>
      <p className="text-lg font-semibold text-gray-900">Bilaget er sendt</p>
      <p className="mt-1 text-sm text-gray-500">Bilags-ID <b>{sendt}</b> — skriv det på den fysiske kvittering, hvis du gemmer den.</p>
      <button onClick={nytBilag} className="mt-6 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white">Nyt bilag</button>
    </Midte>
  )

  const kanSende = billeder.length > 0 && !!butik.trim() && tilTal(beloeb) > 0 && !!formaal.trim() && !!konto &&
    (!valgtKonto?.repraesentation || !!deltagere.trim()) && !sender

  return (
    <main className="mx-auto max-w-lg px-4 pb-28 pt-14">
      <h1 className="text-xl font-bold text-gray-900">Bilag / udlæg</h1>
      <p className="mb-4 text-sm text-gray-500">{ops.bruger?.navn} · kreditor {ops.bruger?.vendorNo}</p>

      {!ops.klar && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Bilagsmailen er ikke sat op i BC endnu, så du kan ikke sende. Kontakt bogholderiet.
        </p>
      )}

      {/* 1. Billeder */}
      <Kasse titel="1. Kvittering">
        <div className="grid grid-cols-3 gap-2">
          {billeder.map((b, i) => (
            <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-lg border bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b} alt={`Billede ${i + 1}`} className="h-full w-full object-cover" />
              <button onClick={() => setBilleder(billeder.filter((_, j) => j !== i))} aria-label="Fjern billede"
                className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-red-600 shadow">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button onClick={() => filRef.current?.click()}
            className="flex aspect-[3/4] flex-col items-center justify-center rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 text-blue-700">
            <Camera className="mb-1 h-7 w-7" />
            <span className="text-xs font-medium">{billeder.length ? 'Flere billeder' : 'Tag billede'}</span>
          </button>
        </div>
        <input ref={filRef} type="file" accept="image/*" capture="environment" multiple hidden
          onChange={e => { tilfoejBilleder(e.target.files); e.target.value = '' }} />
        {aflaeser && <p className="mt-2 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Læser kvitteringen …</p>}
        {billeder.length > 0 && !aflaeser && ops.aflaesning && <p className="mt-2 text-xs text-gray-500">Felterne er udfyldt ud fra billedet — tjek dem.</p>}
      </Kasse>

      {/* 2. Oplysninger */}
      <Kasse titel="2. Oplysninger">
        <Felt label="Købsdato"><input type="date" value={dato} max={idag()} onChange={e => setDato(e.target.value)} className={INPUT} /></Felt>
        <Felt label="Butik / leverandør"><input value={butik} onChange={e => setButik(e.target.value)} placeholder="Fx Circle K Hirtshals" className={INPUT} /></Felt>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Felt label="Beløb inkl. moms"><input inputMode="decimal" value={beloeb} onChange={e => setBeloeb(e.target.value)} placeholder="0,00" className={INPUT} /></Felt>
          <Felt label="Valuta">
            <select value={valuta} onChange={e => setValuta(e.target.value)} className={INPUT}>
              {VALUTAER.map(v => <option key={v}>{v}</option>)}
            </select>
          </Felt>
        </div>
        <Felt label="Heraf moms (hvis den står på kvitteringen)"><input inputMode="decimal" value={moms} onChange={e => setMoms(e.target.value)} placeholder="0,00" className={INPUT} /></Felt>
      </Kasse>

      {/* 3. Betalt med */}
      <Kasse titel="3. Betalt med">
        <Valg aktiv={kortKode === ''} onClick={() => setKortKode('')} titel="Privat udlæg" tekst="Jeg har lagt ud og skal have pengene tilbage." />
        {(ops.kort ?? []).map(k => (
          <Valg key={k.kode} aktiv={kortKode === k.kode} onClick={() => setKortKode(k.kode)} titel={`Firmakort: ${k.beskrivelse}`} />
        ))}
      </Kasse>

      {/* 4. Hvad er det? */}
      <Kasse titel="4. Hvad er udgiften?">
        {(ops.konti ?? []).map(k => (
          <Valg key={k.kontoNr} aktiv={konto === k.kontoNr} onClick={() => setKonto(k.kontoNr)}
            titel={k.tekst} tekst={k.forklaring} hjoerne={k.kontoNr} />
        ))}
        <Valg aktiv={konto === VED_IKKE} onClick={() => setKonto(VED_IKKE)} titel="Ved ikke" tekst="Bogholderiet vælger kontoen." />
      </Kasse>

      {/* 5. Formål */}
      <Kasse titel="5. Formål">
        <Felt label="Hvad var udgiften til?">
          <textarea value={formaal} onChange={e => setFormaal(e.target.value)} rows={2} maxLength={250}
            placeholder="Fx Diesel til bil 3, tur til Hanstholm auktion" className={INPUT} />
        </Felt>
        {valgtKonto?.repraesentation && (
          <Felt label="Anledning og deltagere (påkrævet ved repræsentation)">
            <textarea value={deltagere} onChange={e => setDeltagere(e.target.value)} rows={2} maxLength={250}
              placeholder="Fx Middag med Jens Hansen og Ole Olsen, Dagrofa — forhandling af 2027-aftale" className={INPUT} />
          </Felt>
        )}
      </Kasse>

      {fejl && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{fejl}</p>}

      {dublet && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Er det sendt før?</p>
          <p className="mt-1">Du har allerede sendt et bilag med samme dato og beløb: {dublet.map(d => `${d.bilagId} (${d.merchant})`).join(', ')}.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setDublet(null)} className="flex-1 rounded-lg border border-amber-400 bg-white py-2 font-medium">Fortryd</button>
            <button onClick={() => send(true)} disabled={sender} className="flex-1 rounded-lg bg-amber-600 py-2 font-medium text-white">Send alligevel</button>
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-3">
        <div className="mx-auto max-w-lg">
          <button onClick={() => send(false)} disabled={!kanSende || !ops.klar}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-semibold text-white disabled:bg-gray-300">
            {sender ? <><Loader2 className="h-5 w-5 animate-spin" /> Sender …</> : 'Send bilag'}
          </button>
        </div>
      </div>
    </main>
  )
}

const INPUT = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-blue-500 focus:outline-none'

function Midte({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 text-center">{children}</main>
}

function Kasse({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{titel}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Felt({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm text-gray-600">{label}</span>{children}</label>
}

function Valg({ aktiv, onClick, titel, tekst, hjoerne }: { aktiv: boolean; onClick: () => void; titel: string; tekst?: string; hjoerne?: string }) {
  return (
    <button type="button" onClick={onClick}
      className={'w-full rounded-xl border p-3 text-left ' + (aktiv ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 bg-white')}>
      <span className="flex items-start justify-between gap-2">
        <span className="font-medium text-gray-900">{titel}</span>
        {hjoerne && <span className="text-xs text-gray-400">{hjoerne}</span>}
      </span>
      {tekst && <span className="mt-0.5 block text-sm text-gray-500">{tekst}</span>}
    </button>
  )
}
