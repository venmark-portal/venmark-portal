'use client'

import { useState, useEffect, useRef } from 'react'
import { MessageSquare, Send, ChevronLeft, Circle } from 'lucide-react'

interface Conv {
  customerId: string
  customerName: string
  email: string
  bcCustomerNumber: string
  latestBody: string
  latestAt: string
  latestSender: string
  unreadCount: number
  totalCount: number
}

interface Msg {
  id: string
  sender: string
  senderName: string | null
  body: string
  readByAdmin: boolean
  readByCustomer: boolean
  createdAt: string
}

interface Customer { name: string; email: string; bcCustomerNumber: string }

export default function BeskederPage() {
  const [convs,    setConvs]    = useState<Conv[]>([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [body,     setBody]     = useState('')
  const [sending,  setSending]  = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/admin/messages')
      .then(r => r.json())
      .then(setConvs)
      .finally(() => setLoading(false))
  }, [])

  async function openThread(customerId: string) {
    setSelected(customerId)
    const d = await fetch(`/api/admin/messages/${customerId}`).then(r => r.json())
    setCustomer(d.customer)
    setMessages(d.messages)
    setConvs(prev => prev.map(c => c.customerId === customerId ? { ...c, unreadCount: 0 } : c))
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  async function send() {
    if (!body.trim() || !selected) return
    setSending(true)
    await fetch(`/api/admin/messages/${selected}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    setBody('')
    const d = await fetch(`/api/admin/messages/${selected}`).then(r => r.json())
    setMessages(d.messages)
    setConvs(prev => {
      const exists = prev.find(c => c.customerId === selected)
      const updated = { customerId: selected!, customerName: customer?.name ?? '', email: customer?.email ?? '', bcCustomerNumber: customer?.bcCustomerNumber ?? '', latestBody: body, latestAt: new Date().toISOString(), latestSender: 'admin', unreadCount: 0, totalCount: (exists?.totalCount ?? 0) + 1 }
      return exists ? prev.map(c => c.customerId === selected ? updated : c) : [updated, ...prev]
    })
    setSending(false)
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  const totalUnread = convs.reduce((s, c) => s + c.unreadCount, 0)

  return (
    <div className="flex h-[calc(100vh-120px)] gap-0 overflow-hidden rounded-xl ring-1 ring-gray-200 bg-white">

      {/* Venstre: samtale-liste */}
      <div className={`flex flex-col border-r border-gray-100 ${selected ? 'hidden md:flex' : 'flex'} w-full md:w-80 shrink-0`}>
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
          <MessageSquare size={18} className="text-blue-600" />
          <h1 className="font-semibold text-gray-900">Beskeder</h1>
          {totalUnread > 0 && (
            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-bold text-white">{totalUnread}</span>
          )}
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Henter…</div>
        ) : convs.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400 p-6 text-center">
            Ingen beskeder endnu.<br />Send en notifikation for at starte en samtale.
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto divide-y divide-gray-50">
            {convs.map(c => (
              <li key={c.customerId}>
                <button
                  onClick={() => openThread(c.customerId)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition ${selected === c.customerId ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {c.unreadCount > 0 && <Circle size={8} className="shrink-0 fill-blue-600 text-blue-600" />}
                      <span className={`text-sm truncate ${c.unreadCount > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{c.customerName}</span>
                    </div>
                    <span className="shrink-0 text-xs text-gray-400">
                      {new Date(c.latestAt).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500 truncate">
                    {c.latestSender === 'admin' ? 'Dig: ' : ''}{c.latestBody}
                  </p>
                  {c.unreadCount > 0 && (
                    <span className="mt-1 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                      {c.unreadCount} ny{c.unreadCount > 1 ? 'e' : ''}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Højre: tråd */}
      {selected ? (
        <div className="flex flex-1 flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
            <button onClick={() => setSelected(null)} className="md:hidden rounded p-1 hover:bg-gray-100">
              <ChevronLeft size={18} />
            </button>
            {customer && (
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate">{customer.name}</div>
                <div className="text-xs text-gray-400">{customer.email} · #{customer.bcCustomerNumber}</div>
              </div>
            )}
          </div>

          {/* Beskeder */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-center text-sm text-gray-400 mt-8">Ingen beskeder i denne tråd.</p>
            )}
            {messages.map(m => (
              <div key={m.id} className={`flex ${m.sender === 'admin' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xs lg:max-w-md rounded-2xl px-4 py-2.5 text-sm ${
                  m.sender === 'admin'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                }`}>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className={`mt-1 text-xs ${m.sender === 'admin' ? 'text-blue-200' : 'text-gray-400'}`}>
                    {new Date(m.createdAt).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}
                    {' · '}
                    {new Date(m.createdAt).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })}
                    {m.sender === 'admin' && !m.readByCustomer && ' · Ikke læst'}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Send-felt */}
          <div className="border-t border-gray-100 px-4 py-3">
            <div className="flex gap-2">
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
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center text-sm text-gray-400">
          Vælg en samtale til venstre
        </div>
      )}
    </div>
  )
}
