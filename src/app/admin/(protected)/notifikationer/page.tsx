'use client'

import { useState, useEffect } from 'react'
import { Bell, Send, CheckCircle2, Users } from 'lucide-react'

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
  const [subCount,    setSubCount]    = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/admin/push-subscribers')
      .then(r => r.json())
      .then(d => setSubCount(d.count ?? 0))
      .catch(() => {})
  }, [])

  async function send() {
    if (!title.trim() || !body.trim()) { setError('Udfyld titel og besked'); return }
    setSending(true); setResult(null); setError('')
    try {
      const res = await fetch('/api/admin/push-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), url: url.trim() || '/portal' }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t)
      }
      const d = await res.json()
      setResult(d)
      setTitle(''); setBody(''); setUrl('/portal')
    } catch (e: any) {
      setError(e.message ?? 'Ukendt fejl')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell size={22} className="text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Push-notifikationer</h1>
            <p className="text-sm text-gray-500">Send besked til alle kunder der har aktiveret notifikationer</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 ring-1 ring-gray-200">
          <Users size={16} className="text-gray-400" />
          <span className="text-sm font-semibold text-gray-800">
            {subCount === null ? '…' : subCount}
          </span>
          <span className="text-xs text-gray-400">abonnenter</span>
        </div>
      </div>

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
          disabled={sending || !title.trim() || !body.trim()}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-[0.98] transition disabled:opacity-50"
        >
          <Send size={16} />
          {sending ? 'Sender…' : 'Send til alle'}
        </button>
      </section>
    </div>
  )
}
