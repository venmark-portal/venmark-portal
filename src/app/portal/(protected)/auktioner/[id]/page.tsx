'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useT, useLocale } from '@/lib/i18n/portal/LangProvider'
import type { TFunc } from '@/lib/i18n/portal/lang'
import { auktionDict } from '@/lib/i18n/portal/dict/auktion'

type AuktionKey = keyof typeof auktionDict.da

interface Detail {
  id: string; status: string; currentPrice: number; bidCount: number; minNext: number
  endsAt: string; ended: boolean; youLead: boolean
  title: string; description: string; priceMode: 'TOTAL' | 'PER_KG'
  lotText: string | null; itemNo: string | null; minIncrement: number
  imageIds: string[]; bids: { amount: number; at: string; mine: boolean }[]
}

function useNow(ms = 1000) {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return n
}
function countdown(endsAt: string, now: number, t: TFunc<AuktionKey>): string {
  const d = new Date(endsAt).getTime() - now
  if (d <= 0) return t('afsluttet')
  const s = Math.floor(d / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  return h > 0 ? t('tidTMS', { h, m, s: String(ss).padStart(2, '0') }) : `${m}:${String(ss).padStart(2, '0')}`
}
const unit = (m: string, t: TFunc<AuktionKey>) => ' ' + t('kr') + (m === 'PER_KG' ? t('prKg') : '')

export default function AuktionDetaljePage() {
  const t = useT(auktionDict)
  const locale = useLocale()
  const { id } = useParams<{ id: string }>()
  const [a, setA] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [bidInput, setBidInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const now = useNow()

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/portal/auktioner/${id}`, { cache: 'no-store' })
      if (!r.ok) { setA(null); setLoading(false); return }
      const d: Detail = await r.json()
      setA(d)
      setBidInput((prev) => (prev === '' ? String(d.minNext) : prev))
    } catch { /* ignore */ }
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
    const t = setInterval(load, 2500)
    return () => clearInterval(t)
  }, [load])

  const bid = async () => {
    const amount = Number(bidInput)
    if (!Number.isFinite(amount) || amount <= 0) { setMsg(t('angivGyldigt')); return }
    setBusy(true); setMsg('')
    try {
      const r = await fetch(`/api/portal/auktioner/${id}/bid`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      const d = await r.json()
      if (!d.ok) setMsg(d.error ?? t('kunneIkkeByde'))
      else setMsg(d.leading ? t('duFoererNu') : t('overbudt', { p: d.currentPrice }))
      await load()
    } catch { setMsg(t('serverfejl')) }
    setBusy(false)
  }

  if (loading) return <div className="p-6 text-center text-sm text-gray-400">{t('henter')}</div>
  if (!a) return (
    <div className="p-6 text-center text-sm text-gray-500">
      {t('findesIkke')} <Link href="/portal/auktioner" className="text-blue-600 underline">{t('tilbage')}</Link>
    </div>
  )

  const left = new Date(a.endsAt).getTime() - now
  const soon = left > 0 && left < 2 * 60 * 1000
  const ended = a.ended || left <= 0

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Link href="/portal/auktioner" className="text-sm text-blue-600">{t('alleAuktioner')}</Link>

      {a.imageIds.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {a.imageIds.map((iid) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={iid} src={`/api/portal/auktion-image/${iid}`} alt=""
              className="h-56 w-auto flex-shrink-0 rounded-xl object-cover" />
          ))}
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold text-gray-900">{a.title}</h1>
        {a.lotText && <div className="text-sm text-gray-500">{a.lotText}</div>}
        {a.description && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{a.description}</p>}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase text-gray-400">{t('nuvaerendeBud')}</div>
            <div className="text-3xl font-bold text-gray-900">
              {a.currentPrice > 0 ? a.currentPrice : a.minNext}<span className="text-base font-normal text-gray-500">{unit(a.priceMode, t)}</span>
            </div>
            <div className="text-xs text-gray-400">{t(a.bidCount === 1 ? 'bud1' : 'budN', { n: a.bidCount })}{a.priceMode === 'PER_KG' ? t('prisPrKg') : ''}</div>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold ${soon ? 'text-red-600' : 'text-gray-800'}`}>{countdown(a.endsAt, now, t)}</div>
            {a.youLead && !ended && <div className="mt-1 rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">{t('duFoerer')}</div>}
          </div>
        </div>

        {ended ? (
          <div className={`mt-4 rounded-lg p-3 text-center text-sm font-semibold ${a.youLead ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-600'}`}>
            {a.youLead ? t('vandt') : t('erAfsluttet')}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <label className="block text-sm text-gray-600">
              {t('ditMaksbud')} <span className="text-gray-400">{t('maksbudHjaelp', { p: a.minNext })}</span>
              <input type="number" min={a.minNext} step={a.minIncrement} value={bidInput}
                onChange={(e) => setBidInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-lg font-semibold focus:border-blue-400 focus:outline-none" />
            </label>
            <button onClick={bid} disabled={busy}
              className="w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white transition hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50">
              {busy ? t('byder') : t('byd')}
            </button>
            {msg && <div className="text-center text-sm text-gray-700">{msg}</div>}
          </div>
        )}
      </div>

      {a.bids.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="mb-1 text-xs uppercase text-gray-400">{t('budListe')}</div>
          <ul className="divide-y divide-gray-100 text-sm">
            {a.bids.map((b, i) => (
              <li key={i} className="flex justify-between py-1.5">
                <span className={b.mine ? 'font-semibold text-blue-600' : 'text-gray-500'}>{b.mine ? t('ditBud') : t('bud')}</span>
                <span className="tabular-nums">{b.amount}{unit(a.priceMode, t)} · {new Date(b.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
