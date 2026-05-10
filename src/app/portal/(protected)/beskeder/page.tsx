'use client'

import { useState, useEffect, useRef } from 'react'
import { Send, MessageSquare } from 'lucide-react'

interface Msg {
  id: string
  sender: string
  senderName: string | null
  body: string
  readByCustomer: boolean
  createdAt: string
}

export default function BeskederPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading,  setLoading]  = useState(true)
  const [body,     setBody]     = useState('')
  const [sending,  setSending]  = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function load() {
    const d = await fetch('/api/portal/messages').then(r => r.json())
    setMessages(d.messages ?? [])
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  async function send() {
    if (!body.trim()) return
    setSending(true)
    await fetch('/api/portal/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    setBody('')
    await load()
    setSending(false)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] max-w-2xl">

      <div className="mb-4 flex items-center gap-3">
        <MessageSquare size={20} className="text-blue-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Beskeder</h1>
          <p className="text-xs text-gray-400">Direkte kontakt med Venmark — beskeder gemmes i 30 dage</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto rounded-xl bg-white ring-1 ring-gray-200 p-4 space-y-3">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">Henter…</div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-gray-400">
            <MessageSquare size={32} className="text-gray-200" />
            <p>Ingen beskeder endnu.<br />Send en besked nedenfor.</p>
          </div>
        ) : messages.map(m => (
          <div key={m.id} className={`flex ${m.sender === 'customer' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs sm:max-w-sm rounded-2xl px-4 py-2.5 text-sm ${
              m.sender === 'customer'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-gray-100 text-gray-900 rounded-bl-sm'
            }`}>
              {m.sender === 'admin' && (
                <p className="text-xs font-semibold text-gray-500 mb-0.5">{m.senderName ?? 'Venmark'}</p>
              )}
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className={`mt-1 text-xs ${m.sender === 'customer' ? 'text-blue-200' : 'text-gray-400'}`}>
                {new Date(m.createdAt).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}
                {' · '}
                {new Date(m.createdAt).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 flex gap-2">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Skriv en besked… (Enter for at sende)"
          rows={2}
          className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        />
        <button
          onClick={send}
          disabled={sending || !body.trim()}
          className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Send size={15} />
          Send
        </button>
      </div>
    </div>
  )
}
