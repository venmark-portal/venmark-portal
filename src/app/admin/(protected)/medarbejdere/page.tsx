'use client'

// Medarbejdere: ét login (e-mail + kode) med en eller flere roller. Rollerne skiftes med
// rolleskiftet øverst på siden. Chauffør- og lager-PIN virker som før.

import { useEffect, useState } from 'react'
import { UserPlus, Mail, ShieldCheck, Warehouse, Truck, ShoppingCart, Check } from 'lucide-react'

interface Raekke {
  id: string; navn: string; email: string; aktiv: boolean; harKode: boolean
  adminUserId: string | null; lagerUserId: string | null; driverUserId: string | null; customerId: string | null
  kundeNr: string | null; kundeNavn: string | null; chauffoerNavn: string | null
  lagerNavn: string | null; lagerInitialer: string | null; lagerTaelle: boolean | null; lagerPakke: boolean | null
}
interface Valg { id: string; name: string; initials?: string | null }

export default function MedarbejderePage() {
  const [liste, setListe]   = useState<Raekke[]>([])
  const [chauf, setChauf]   = useState<Valg[]>([])
  const [lager, setLager]   = useState<Valg[]>([])
  const [indl, setIndl]     = useState(true)
  const [navn, setNavn]     = useState('')
  const [email, setEmail]   = useState('')
  const [besked, setBesked] = useState<{ ok: boolean; tekst: string } | null>(null)
  const [travl, setTravl]   = useState('')

  async function hent() {
    const r = await fetch('/api/admin/medarbejder-login', { cache: 'no-store' })
    if (r.ok) {
      const d = await r.json()
      setListe(d.medarbejdere); setChauf(d.chauffoerer); setLager(d.lager)
    }
    setIndl(false)
  }
  useEffect(() => { hent() }, [])

  async function gem(id: string, data: Record<string, unknown>, ok = 'Gemt.') {
    setTravl(id); setBesked(null)
    const r = await fetch('/api/admin/medarbejder-login', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...data }),
    })
    const d = await r.json().catch(() => ({}))
    setBesked(r.ok ? { ok: true, tekst: ok } : { ok: false, tekst: d.fejl ?? 'Kunne ikke gemme.' })
    setTravl('')
    await hent()
  }

  async function opret(e: React.FormEvent) {
    e.preventDefault()
    setTravl('ny'); setBesked(null)
    const r = await fetch('/api/admin/medarbejder-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ navn, email }),
    })
    const d = await r.json().catch(() => ({}))
    setTravl('')
    if (!r.ok) { setBesked({ ok: false, tekst: d.fejl ?? 'Kunne ikke oprette.' }); return }
    setNavn(''); setEmail('')
    setBesked({ ok: true, tekst: d.kodeOvertaget
      ? 'Oprettet. Personen bruger samme kode som sit nuværende login. Giv nu roller nedenfor.'
      : 'Oprettet. Giv roller nedenfor, og send et link så personen kan vælge sin kode.' })
    await hent()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Medarbejdere</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Ét login pr. medarbejder med e-mail og kode. Har man flere roller, skifter man mellem dem med
          rolleskiftet øverst på siden. Chauffør- og lager-PIN virker som før, og er PIN-brugeren koblet til en
          medarbejder, kan man også skifte rolle derfra.
        </p>
      </div>

      <form onSubmit={opret} className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 ring-1 ring-gray-200">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">Navn</span>
          <input id="ny-navn" value={navn} onChange={e => setNavn(e.target.value)} required
            className="w-56 rounded-lg border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">E-mail</span>
          <input id="ny-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required
            className="w-64 rounded-lg border border-gray-300 px-3 py-2" />
        </label>
        <button disabled={travl === 'ny'}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          <UserPlus size={16} /> Opret medarbejder
        </button>
      </form>

      {besked && (
        <p className={'rounded-lg px-4 py-2 text-sm ' + (besked.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700')}>{besked.tekst}</p>
      )}

      {indl ? <p className="text-sm text-gray-500">Henter …</p> : liste.length === 0 ? (
        <p className="text-sm text-gray-500">Ingen medarbejdere endnu.</p>
      ) : (
        <div className="space-y-3">
          {liste.map(m => (
            <Kort key={m.id} m={m} chauf={chauf} lager={lager} travl={travl === m.id} gem={(d, ok) => gem(m.id, d, ok)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Kort({ m, chauf, lager, travl, gem }: {
  m: Raekke; chauf: Valg[]; lager: Valg[]; travl: boolean
  gem: (d: Record<string, unknown>, ok?: string) => void
}) {
  const [kundeNr, setKundeNr] = useState(m.kundeNr ?? '')
  const [lagerValg, setLagerValg] = useState(m.lagerUserId ?? '')
  const [pin, setPin] = useState('')
  const [initialer, setInitialer] = useState(m.lagerInitialer ?? '')
  const [taelle, setTaelle] = useState(m.lagerTaelle ?? true)
  const [pakke, setPakke] = useState(m.lagerPakke ?? true)

  const rolleTal = [m.adminUserId, m.lagerUserId, m.driverUserId, m.customerId].filter(Boolean).length

  return (
    <div className={'rounded-xl bg-white p-4 ring-1 ring-gray-200 ' + (m.aktiv ? '' : 'opacity-60')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-900">{m.navn}</p>
          <p className="text-sm text-gray-500">
            {m.email} · {m.harKode ? 'har kode' : <span className="text-amber-700">ingen kode endnu</span>} · {rolleTal} {rolleTal === 1 ? 'rolle' : 'roller'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={travl} onClick={() => gem({ sendLink: true }, `Link sendt til ${m.email}.`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <Mail size={15} /> {m.harKode ? 'Send link til ny kode' : 'Send link til at vælge kode'}
          </button>
          <button type="button" disabled={travl} onClick={() => gem({ aktiv: !m.aktiv }, m.aktiv ? 'Spærret.' : 'Genåbnet.')}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {m.aktiv ? 'Spær' : 'Genåbn'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {/* Kunde */}
        <Rolle ikon={<ShoppingCart size={16} />} titel="Kunde (egen debitor)" aktiv={!!m.customerId}
          info={m.customerId ? `${m.kundeNr} ${m.kundeNavn ?? ''}` : 'Bestiller til sig selv på sit eget debitornummer.'}>
          <div className="flex gap-2">
            <input id={`kunde-${m.id}`} value={kundeNr} onChange={e => setKundeNr(e.target.value)} placeholder="Debitornr."
              className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
            <button type="button" disabled={travl} onClick={() => gem({ kundeNr })}
              className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">{kundeNr ? 'Gem' : 'Fjern'}</button>
          </div>
        </Rolle>

        {/* Lager/pakker */}
        <Rolle ikon={<Warehouse size={16} />} titel="Lager/pakker" aktiv={!!m.lagerUserId}
          info={m.lagerUserId ? `${m.lagerNavn}${m.lagerTaelle ? ' · tæller' : ''}${m.lagerPakke ? ' · pakker' : ''}` : 'Lager-appen (optælling og pakning) med navn + PIN.'}>
          <div className="space-y-2">
            <select id={`lager-${m.id}`} value={lagerValg} onChange={e => setLagerValg(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">— ingen —</option>
              <option value="ny">Opret ny lager-bruger</option>
              {lager.map(l => <option key={l.id} value={l.id}>{l.name}{l.initials ? ` (${l.initials})` : ''}</option>)}
            </select>
            {lagerValg && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input id={`pin-${m.id}`} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
                  placeholder={lagerValg === 'ny' ? 'PIN (4-8 cifre)' : 'Ny PIN (valgfri)'} className="w-36 rounded-lg border border-gray-300 px-2 py-1.5" />
                <input id={`ini-${m.id}`} value={initialer} onChange={e => setInitialer(e.target.value)} placeholder="Initialer"
                  className="w-24 rounded-lg border border-gray-300 px-2 py-1.5" />
                <label className="flex items-center gap-1"><input type="checkbox" checked={taelle} onChange={e => setTaelle(e.target.checked)} /> Tæller</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={pakke} onChange={e => setPakke(e.target.checked)} /> Pakker</label>
              </div>
            )}
            <button type="button" disabled={travl} onClick={() => {
              gem({ lager: lagerValg ? { ...(lagerValg === 'ny' ? { ny: true } : { id: lagerValg }), pin, initialer, taelle, pakke } : null })
              setPin('')
            }} className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">{lagerValg ? 'Gem' : 'Fjern'}</button>
          </div>
        </Rolle>

        {/* Admin */}
        <Rolle ikon={<ShieldCheck size={16} />} titel="Admin" aktiv={!!m.adminUserId}
          info="Hele admin-delen: kunder, ordrer, leveringer, skærme …">
          <button type="button" disabled={travl} onClick={() => gem({ admin: !m.adminUserId })}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {m.adminUserId ? 'Fjern admin' : 'Giv admin'}
          </button>
        </Rolle>

        {/* Chauffør */}
        <Rolle ikon={<Truck size={16} />} titel="Chauffør" aktiv={!!m.driverUserId}
          info={m.driverUserId ? `${m.chauffoerNavn}, PIN fra BC som før` : 'Chauffør-appen. Chaufførerne kommer fra BC.'}>
          <select id={`chauf-${m.id}`} value={m.driverUserId ?? ''} disabled={travl}
            onChange={e => gem({ chauffoerId: e.target.value || null })}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">— ingen —</option>
            {chauf.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Rolle>
      </div>
    </div>
  )
}

function Rolle({ ikon, titel, aktiv, info, children }: {
  ikon: React.ReactNode; titel: string; aktiv: boolean; info: string; children: React.ReactNode
}) {
  return (
    <div className={'space-y-2 rounded-lg p-3 ring-1 ' + (aktiv ? 'bg-blue-50/60 ring-blue-200' : 'bg-gray-50 ring-gray-200')}>
      <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
        {ikon} {titel}
        {aktiv && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] text-white"><Check size={11} /> har rollen</span>}
      </p>
      <p className="text-xs text-gray-600">{info}</p>
      {children}
    </div>
  )
}
