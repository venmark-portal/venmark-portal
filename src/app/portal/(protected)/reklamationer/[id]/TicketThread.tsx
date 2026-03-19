'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Loader2 } from 'lucide-react'

interface Message {
  id:             string
  sender:         string
  senderName:     string | null
  body:           string
  readByCustomer: boolean
  createdAt:      string
}

interface TicketImage {
  id:       string
  data:     string
  mimeType: string
  fileName: string
}

interface Ticket {
  id:       string
  subject:  string
  body:     string
  status:   string
  orderRef: string | null
  messages: Message[]
  images:   TicketImage[]
  createdAt: string
}

export default function TicketThread({ ticket }: { ticket: Ticket }) {
  const [messages, setMessages] = useState<Message[]>(ticket.messages)
  const [reply,    setReply]    = useState('')
  const [sending,  setSending]  = useState(false)
  const [error,    setError]    = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Poll for nye beskeder hvert 15. sekund
  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/portal/reklamationer/${ticket.id}`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages ?? [])
      }
    }, 15000)
    return () => clearInterval(interval)
  }, [ticket.id])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim()) return
    setSending(true)
    setError('')
    try {
      const res = await fetch(`/api/portal/reklamationer/${ticket.id}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: reply }),
      })
      if (!res.ok) throw new Error(await res.text())
      const msg = await res.json()
      setMessages(prev => [...prev, msg])
      setReply('')
    } catch (e: any) {
      setError(e.message ?? 'Fejl')
    } finally {
      setSending(false)
    }
  }

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  const statusColor = ticket.status === 'CLOSED' ? 'bg-gray-100 text-gray-600'
    : ticket.status === 'IN_PROGRESS'            ? 'bg-blue-100 text-blue-800'
    :                                              'bg-yellow-100 text-yellow-800'

  const statusLabel = ticket.status === 'CLOSED' ? 'Lukket'
    : ticket.status === 'IN_PROGRESS'            ? 'Under behandling'
    :                                              'Åben'

  return (
    <div className="space-y-3">
      {/* Oprindelig beskrivelse */}
      <div className="rounded-xl bg-white ring-1 ring-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
          <span className="text-xs text-gray-400">{fmt(ticket.createdAt)} · Din reklamation</span>
          <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${statusColor}`}>{statusLabel}</span>
        </div>
        <div className="p-4 text-sm text-gray-800 whitespace-pre-wrap">{ticket.body}</div>

        {/* Vedhæftede billeder */}
        {ticket.images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            {ticket.images.map(img => (
              <a key={img.id} href={`data:${img.mimeType};base64,${img.data}`} target="_blank" rel="noreferrer">
                <img
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={img.fileName}
                  className="h-20 w-20 rounded-lg object-cover ring-1 ring-gray-200 hover:opacity-80 transition"
                />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Besked-tråd */}
      {messages.length > 0 && (
        <div className="space-y-2">
          {messages.map(msg => {
            const isStaff = msg.sender === 'STAFF'
            return (
              <div key={msg.id} className={`flex ${isStaff ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                  isStaff
                    ? 'bg-white ring-1 ring-gray-200 text-gray-800 rounded-tl-sm'
                    : 'bg-blue-600 text-white rounded-tr-sm'
                }`}>
                  {isStaff && (
                    <p className="text-[10px] font-semibold text-gray-400 mb-1">
                      {msg.senderName ?? 'Venmark'}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap">{msg.body}</p>
                  <p className={`text-[10px] mt-1 ${isStaff ? 'text-gray-400' : 'text-blue-200'}`}>
                    {fmt(msg.createdAt)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div ref={bottomRef} />

      {/* Svar-boks */}
      {ticket.status !== 'CLOSED' && (
        <form onSubmit={handleSend} className="rounded-xl bg-white ring-1 ring-gray-200 p-3 flex gap-2">
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder="Skriv et svar..."
            rows={2}
            className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e as any) } }}
          />
          <button
            type="submit"
            disabled={sending || !reply.trim()}
            className="self-end flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
