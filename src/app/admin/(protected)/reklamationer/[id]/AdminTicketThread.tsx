'use client'

import { useState } from 'react'
import { Send, Loader2 } from 'lucide-react'

interface Message {
  id: string
  sender: string
  senderName: string | null
  body: string
  createdAt: string
}

interface Props {
  ticketId: string
  initialMessages: Message[]
  status: string
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  OPEN:        { label: 'Åben',             color: 'bg-yellow-100 text-yellow-800' },
  IN_PROGRESS: { label: 'Under behandling', color: 'bg-blue-100 text-blue-800'    },
  CLOSED:      { label: 'Lukket',           color: 'bg-gray-100 text-gray-600'    },
}

export default function AdminTicketThread({ ticketId, initialMessages, status }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [reply, setReply]       = useState('')
  const [sending, setSending]   = useState(false)
  const [error, setError]       = useState('')
  const [closed, setClosed]     = useState(status === 'CLOSED')

  async function sendReply() {
    if (!reply.trim()) return
    setSending(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/reklamationer/${ticketId}/reply`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: reply.trim() }),
      })
      if (!res.ok) throw new Error(await res.text())
      const msg = await res.json()
      setMessages(prev => [...prev, { ...msg, createdAt: msg.createdAt ?? new Date().toISOString() }])
      setReply('')
      setClosed(false)
    } catch {
      setError('Kunne ikke sende svar. Prøv igen.')
    } finally {
      setSending(false)
    }
  }

  async function toggleClose() {
    const newStatus = closed ? 'IN_PROGRESS' : 'CLOSED'
    await fetch(`/api/admin/reklamationer/${ticketId}/reply`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: newStatus }),
    })
    setClosed(!closed)
  }

  const st = STATUS_LABELS[closed ? 'CLOSED' : 'IN_PROGRESS']

  return (
    <div className="space-y-4">

      {/* Status + luk-knap */}
      <div className="flex items-center justify-between">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.color}`}>{st.label}</span>
        <button
          onClick={toggleClose}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition ${
            closed
              ? 'border-blue-300 text-blue-700 hover:bg-blue-50'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {closed ? '↩ Genåbn sag' : '✓ Luk sag'}
        </button>
      </div>

      {/* Beskeder */}
      <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
        {messages.map(msg => {
          const isStaff = msg.sender === 'STAFF'
          return (
            <div key={msg.id} className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                isStaff
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-white ring-1 ring-gray-200 text-gray-800 rounded-bl-sm'
              }`}>
                <p className={`text-[10px] font-semibold mb-1 ${isStaff ? 'text-blue-200' : 'text-gray-400'}`}>
                  {msg.senderName ?? (isStaff ? 'Venmark' : 'Kunde')}
                </p>
                <p style={{ whiteSpace: 'pre-wrap' }}>{msg.body}</p>
                <p className={`text-[10px] mt-1 text-right ${isStaff ? 'text-blue-300' : 'text-gray-400'}`}>
                  {new Date(msg.createdAt).toLocaleString('da-DK', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          )
        })}
        {messages.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">Ingen beskeder endnu</p>
        )}
      </div>

      {/* Svar-felt */}
      {!closed && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendReply() }}
            placeholder="Skriv svar til kunden… (Ctrl+Enter sender)"
            rows={4}
            className="w-full resize-none px-4 py-3 text-sm text-gray-800 outline-none placeholder:text-gray-400"
          />
          {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 bg-gray-50">
            <span className="text-xs text-gray-400">Svaret vises i kundens portal med det samme</span>
            <button
              onClick={sendReply}
              disabled={sending || !reply.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send svar
            </button>
          </div>
        </div>
      )}
      {closed && (
        <p className="text-center text-xs text-gray-400 py-2">Sagen er lukket — genåbn for at svare</p>
      )}
    </div>
  )
}
