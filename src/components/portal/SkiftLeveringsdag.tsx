'use client'

// "Skift leveringsdag" på ordresiden: vælg en af leveringsformens næste dage → tjek (kan alle
// varer leveres, ny afsendelsesdag) → bekræft → flyt. Samme regler som svar-robotten
// (src/lib/flytLevering.ts + BC cu 50482).

import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { useT, useLocale } from '@/lib/i18n/portal/LangProvider'
import { ordrerDict } from '@/lib/i18n/portal/dict/ordrer'

interface Tjek {
  ok: boolean
  fejl?: string
  flyttet?: boolean
  til?: string
  afsendelsesdato?: string
  samletMed?: string
  problemer?: { varenr: string; navn: string; antal: number; maks: number; enhed: string }[]
}

export default function SkiftLeveringsdag({ ordrenr }: { ordrenr: string }) {
  const t = useT(ordrerDict)
  const locale = useLocale()
  const [aaben, setAaben] = useState(false)
  const [dage, setDage]   = useState<string[] | null>(null)
  const [fejl, setFejl]   = useState('')
  const [valgt, setValgt] = useState('')
  const [tjek, setTjek]   = useState<Tjek | null>(null)
  const [travl, setTravl] = useState(false)

  const dagTekst = (ymd: string) =>
    new Date(`${ymd}T00:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

  async function aabn() {
    setAaben(true); setFejl(''); setTjek(null); setValgt(''); setTravl(true)
    try {
      const r = await fetch(`/api/portal/order/flyt?ordrenr=${encodeURIComponent(ordrenr)}`, { cache: 'no-store' }).then(r => r.json())
      if (!r.ok) setFejl(r.fejl ?? '')
      else setDage(r.dage ?? [])
    } catch { setFejl('BC svarede ikke.') } finally { setTravl(false) }
  }

  async function send(dato: string, udfoer: boolean) {
    setTravl(true); setFejl('')
    try {
      const r: Tjek = await fetch('/api/portal/order/flyt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordrenr, nyDato: dato, udfoer }),
      }).then(r => r.json())
      setTjek(r)
      if (r.flyttet) setTimeout(() => window.location.reload(), 1500)
    } catch { setFejl('BC svarede ikke.') } finally { setTravl(false) }
  }

  if (!aaben) {
    return (
      <button type="button" onClick={aabn} className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800">
        <CalendarClock size={15} />
        {t('skiftDag')}
      </button>
    )
  }

  return (
    <div className="space-y-3 rounded-xl bg-white p-4 text-sm ring-1 ring-gray-200">
      <p className="font-medium text-gray-900">{t('vaelgNyDag')}</p>
      {travl && !dage && <p className="text-gray-500">{t('tjekker')}</p>}
      {dage && dage.length === 0 && <p className="text-gray-500">{t('ingenDage')}</p>}
      {dage && dage.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {dage.map(d => (
            <button key={d} type="button" disabled={travl || !!tjek?.flyttet}
              onClick={() => { setValgt(d); setTjek(null); send(d, false) }}
              aria-pressed={valgt === d}
              className={'rounded-lg px-3 py-1.5 capitalize ring-1 transition ' +
                (valgt === d ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-gray-700 ring-gray-300 hover:ring-blue-400')}>
              {dagTekst(d)}
            </button>
          ))}
        </div>
      )}

      {travl && valgt && <p className="text-gray-500">{tjek ? t('flytter') : t('tjekker')}</p>}
      {fejl && <p className="text-red-600">{fejl}</p>}

      {tjek && !tjek.ok && (
        <div className="rounded-lg bg-amber-50 p-3 text-amber-900">
          <p>{tjek.problemer?.length ? t('ikkeLeveres') : tjek.fejl}</p>
          {!!tjek.problemer?.length && (
            <ul className="mt-1 list-disc pl-5">
              {tjek.problemer.map(p => (
                <li key={p.varenr}>{p.navn} ({p.varenr}): {p.antal} {p.enhed} — {t('maksDag', { n: p.maks, enhed: p.enhed })}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tjek?.ok && !tjek.flyttet && valgt && (
        <div className="space-y-2 rounded-lg bg-blue-50 p-3 text-blue-900">
          <p>{t('kanFlyttes', { dato: dagTekst(valgt), afs: tjek.afsendelsesdato ? dagTekst(tjek.afsendelsesdato) : '' })}</p>
          {tjek.samletMed && <p className="font-medium">{t('samles', { nr: tjek.samletMed })}</p>}
          <button type="button" disabled={travl} onClick={() => send(valgt, true)}
            className="rounded-lg bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {t('flyt')}
          </button>
        </div>
      )}

      {tjek?.flyttet && <p className="rounded-lg bg-green-50 p-3 text-green-800">{t('flyttet', { dato: dagTekst(valgt) })}</p>}

      {!tjek?.flyttet && (
        <button type="button" onClick={() => setAaben(false)} className="text-xs text-gray-500 hover:text-gray-700">{t('annuller')}</button>
      )}
    </div>
  )
}
