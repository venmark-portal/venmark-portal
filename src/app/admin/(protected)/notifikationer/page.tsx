'use client'

import { useState, useEffect } from 'react'
import { Bell, Send, CheckCircle2, Users, Smartphone, ChevronDown, ChevronUp } from 'lucide-react'

interface Subscriber {
  customerId: string
  customerName: string
  email: string
  bcCustomerNumber: string
  devices: number
}

const QUICK_MESSAGES = [
  { title: 'Priser opdateret', body: 'Vi har netop opdateret vores priser. Se de nyeste priser i portalen.' },
  { title: 'Ekstra gode tilbud', body: 'Vi har ekstra gode tilbud i dag — bestil nu mens det er muligt.' },
  { title: 'Ny vare på lager', body: 'En ny vare er tilgængelig i portalen. Se vores sortiment nu.' },
  { title: 'Leveringsinfo', body: 'Vi har opdateret leveringsinformation. Tjek din ordrestatus.' },
]

export default function NotifikationerPage() {
  const [title,       setTitle]       = useState('')
  const [body,        setBody]        = useState('')
  const [url,         setUrl]         = useState('/portal')
  const [sending,     setSending]     = useState(false)
  const [result,      setResult]      = useState<{ sent: number; failed: number; total: number } | null>(null)
  const [error,       setError]       = useState('')
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [loadingSubs, setLoadingSubs] = useState(true)
  const [selected,    setSelected]    = useState<Set<string>>(new Set())
  const [showSubs,    setShowSubs]    = useState(false)

  useEffect(() => {
    fetch('/api/admin/push-subscribers')
      .then(r => r.json())
      .then(d => setSubscribers(d.subscribers ?? []))
      .catch(() => {})
      .finally(() => setLoadingSubs(false))
  }, [])

  const allSelected = selected.size === subscribers.length && subscribers.length > 0
  const noneSelected = selected.size === 0

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(subscribers.map(s => s.customerId)))
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function send() {
    if (!title.trim() || !body.trim()) { setError('Udfyld titel og besked'); return }
    setSending(true); setResult(null); setError('')
    try {
      const customerIds = noneSelected ? undefined : [...selected]
      const res = await fetch('/api/admin/push-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), url: url.trim() || '/portal', customerIds }),
      })
      if (!res.ok) throw new Error(await res.text())
      const d = await res.json()
      setResult(d)
      setTitle(''); setBody(''); setUrl('/portal'); setSelected(new Set())
    } catch (e: any) {
      setError(e.message ?? 'Ukendt fejl')
    } finally {
      setSending(false)
    }
  }

  const targetLabel = noneSelected
    ? `Alle ${subscribers.length} abonnenter`
    : `${selected.size} udvalgt${selected.size === 1 ? '' : 'e'}`

  return (
    <div className="max-w-2xl space-y-6">

      {/* Header med tæller */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell size={22} className="text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Push-notifikationer</h1>
            <p className="text-sm text-gray-500">Send besked til kunder der har aktiveret notifikationer</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 ring-1 ring-gray-200">
          <Users size={16} className="text-gray-400" />
          <span className="text-sm font-semibold text-gray-800">
            {loadingSubs ? '…' : subscribers.length}
          </span>
          <span className="text-xs text-gray-400">abonnenter</span>
        </div>
      </div>

      {/* Abonnentliste */}
      <section className="rounded-xl bg-white ring-1 ring-gray-200">
        <button
          onClick={() => setShowSubs(v => !v)}
          className="flex w-full items-center justify-between px-6 py-4 text-left"
        >
          <div className="flex items-center gap-2">
            <Smartphone size={16} className="text-gray-400" />
            <span className="font-semibold text-gray-800 text-sm">
              {loadingSubs ? 'Henter abonnenter…' : `${subscribers.length} abonnenter`}
            </span>
            {!noneSelected && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                {selected.size} valgt
              </span>
            )}
          </div>
          {showSubs ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </button>

        {showSubs && (
          <div className="border-t border-gray-100">
            {subscribers.length === 0 ? (
              <p className="px-6 py-4 text-sm text-gray-400">Ingen abonnenter endnu.</p>
            ) : (
              <>
                {/* Vælg alle */}
                <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-3 bg-gray-50">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {allSelected ? 'Fravælg alle' : 'Vælg alle'}
                  </span>
                </div>

                {/* Kundeliste */}
                <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                  {subscribers.map(sub => (
                    <li key={sub.customerId}>
                      <label className="flex cursor-pointer items-center gap-3 px-6 py-3 hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={selected.has(sub.customerId)}
                          onChange={() => toggleOne(sub.customerId)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 truncate">{sub.customerName}</span>
                            <span className="shrink-0 text-xs text-gray-400">#{sub.bcCustomerNumber}</span>
                          </div>
                          <span className="text-xs text-gray-400">{sub.email}</span>
                        </div>
                        <span className="shrink-0 text-xs text-gray-400">
                          {sub.devices} enhed{sub.devices !== 1 ? 'er' : ''}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      {/* Hurtige skabeloner */}
      <section className="rounded-xl bg-white p-6 ring-1 ring-gray-200 space-y-3">
        <h2 className="font-semibold text-gray-800 text-sm">Hurtige skabeloner</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {QUICK_MESSAGES.map(m => (
            <button
              key={m.title}
              onClick={() => { setTitle(m.title); setBody(m.body) }}
              className="rounded-lg border border-gray-200 px-3 py-2.5 text-left text-xs hover:border-blue-300 hover:bg-blue-50 transition"
            >
              <div className="font-semibold text-gray-800">{m.title}</div>
              <div className="mt-0.5 text-gray-500 line-clamp-1">{m.body}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Formular */}
      <section className="rounded-xl bg-white p-6 ring-1 ring-gray-200 space-y-4">
        <h2 className="font-semibold text-gray-800 text-sm">Besked</h2>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Titel</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="f.eks. Priser opdateret"
            maxLength={80}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Besked</label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="f.eks. Vi har netop opdateret vores priser."
            maxLength={200}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none resize-none"
          />
          <p className="mt-0.5 text-right text-xs text-gray-400">{body.length}/200</p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Link (klikkes ved åbning)</label>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="/portal/bestil"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
        )}

        {result && (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
            <CheckCircle2 size={16} />
            Sendt til {result.sent} ud af {result.total} abonnenter
            {result.failed > 0 && ` (${result.failed} fejlede)`}
          </div>
        )}

        <button
          onClick={send}
          disabled={sending || !title.trim() || !body.trim() || subscribers.length === 0}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-[0.98] transition disabled:opacity-50"
        >
          <Send size={16} />
          {sending ? 'Sender…' : `Send til ${targetLabel}`}
        </button>
      </section>
    </div>
  )
}
