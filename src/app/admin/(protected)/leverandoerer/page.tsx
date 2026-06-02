'use client'

import { useState, useEffect } from 'react'
import { Search, Send, CheckCircle2, XCircle, Clock, AlertTriangle, FileText, RefreshCw, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { LANG_LABELS, type Lang } from '@/lib/leverandoer/i18n'

type Decl = {
  id: string; bcVendorNo: string; companyName: string | null; email: string | null
  lang: string; status: string; submittedAt: string | null; approvedAt: string | null
  nextRenewalDate: string | null; token: string; country: string | null
  signerName: string | null; signerEmail: string | null; signerTitle: string | null
  documents: { id: string; docType: string; fileName: string }[]
  reminders: { sentAt: string; type: string }[]
  updatedAt: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING:   { label: 'Afventer', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: <Clock size={12} /> },
  SUBMITTED: { label: 'Indsendt', color: 'bg-blue-100 text-blue-800 border-blue-200', icon: <FileText size={12} /> },
  APPROVED:  { label: 'Godkendt', color: 'bg-green-100 text-green-800 border-green-200', icon: <CheckCircle2 size={12} /> },
  EXPIRED:   { label: 'Udløbet', color: 'bg-red-100 text-red-800 border-red-200', icon: <AlertTriangle size={12} /> },
}

function monthsAgo(date: string | null): number {
  if (!date) return 999
  return Math.floor((Date.now() - new Date(date).getTime()) / (30 * 24 * 60 * 60 * 1000))
}

function urgencyColor(decl: Decl): string {
  if (decl.status === 'APPROVED') {
    const m = monthsAgo(decl.approvedAt)
    if (m >= 11) return 'border-l-4 border-l-red-400'
    if (m >= 10) return 'border-l-4 border-l-yellow-400'
    return ''
  }
  if (decl.status === 'PENDING' || decl.status === 'EXPIRED') return 'border-l-4 border-l-red-400'
  return ''
}

export default function LeverandoererPage() {
  const [decls, setDecls]       = useState<Decl[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [filter, setFilter]     = useState('ALL')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sending, setSending]   = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)

  // Send-link modal state
  const [showSendModal, setShowSendModal] = useState(false)
  const [newVendorNo, setNewVendorNo]     = useState('')
  const [newVendorName, setNewVendorName] = useState('')
  const [newVendorEmail, setNewVendorEmail] = useState('')
  const [newLang, setNewLang]             = useState<Lang>('en')
  const [sendResult, setSendResult]       = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const r = await fetch('/api/admin/leverandoerer')
    if (r.ok) setDecls(await r.json())
    setLoading(false)
  }

  async function approve(id: string, action: 'approve' | 'reject') {
    setApproving(id)
    await fetch('/api/leverandoer/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    await load()
    setApproving(null)
  }

  async function sendLink() {
    if (!newVendorNo || !newVendorEmail) return
    setSending('new')
    const r = await fetch('/api/leverandoer/send-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bcVendorNo: newVendorNo, vendorName: newVendorName, vendorEmail: newVendorEmail, lang: newLang }),
    })
    setSendResult(r.ok ? '✅ Link sendt!' : '❌ Fejl ved afsendelse')
    await load()
    setSending(null)
  }

  async function resend(decl: Decl) {
    if (!decl.email && !decl.signerEmail) return alert('Ingen email registreret')
    setSending(decl.id)
    await fetch('/api/leverandoer/send-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bcVendorNo: decl.bcVendorNo, vendorName: decl.companyName, vendorEmail: decl.email || decl.signerEmail, lang: decl.lang }),
    })
    setSending(null)
    alert('Link gensendt')
  }

  const filtered = decls.filter(d => {
    const s = search.toLowerCase()
    const matchSearch = !s || (d.companyName ?? '').toLowerCase().includes(s) || d.bcVendorNo.toLowerCase().includes(s) || (d.email ?? '').toLowerCase().includes(s)
    const matchFilter = filter === 'ALL' || d.status === filter
    return matchSearch && matchFilter
  })

  // Statistik
  const stats = {
    total:    decls.length,
    approved: decls.filter(d => d.status === 'APPROVED').length,
    submitted:decls.filter(d => d.status === 'SUBMITTED').length,
    pending:  decls.filter(d => d.status === 'PENDING').length,
    expired:  decls.filter(d => d.status === 'EXPIRED' || (d.status !== 'APPROVED' && monthsAgo(d.updatedAt) > 12)).length,
  }

  return (
    <div className="space-y-6 max-w-6xl">

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leverandørerklæringer</h1>
          <p className="text-sm text-gray-500">Oversigt over alle leverandørers erklæringsstatus</p>
        </div>
        <button onClick={() => { setShowSendModal(true); setSendResult('') }}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition">
          <Send size={15} /> Send ny erklæring
        </button>
      </div>

      {/* Statistik */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Godkendt',  val: stats.approved,  color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Indsendt',  val: stats.submitted, color: 'text-blue-600',  bg: 'bg-blue-50'  },
          { label: 'Afventer',  val: stats.pending,   color: 'text-yellow-600',bg: 'bg-yellow-50'},
          { label: 'Udløbet',   val: stats.expired,   color: 'text-red-600',   bg: 'bg-red-50'   },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-xl p-4 text-center`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.val}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter + søg */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Søg leverandør, nr. eller email…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-300"
          />
        </div>
        {['ALL','APPROVED','SUBMITTED','PENDING','EXPIRED'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-2 text-xs font-medium border transition ${filter === f ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
          >{f === 'ALL' ? `Alle (${stats.total})` : STATUS_CONFIG[f]?.label ?? f}</button>
        ))}
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500 hover:border-gray-300 transition">
          <RefreshCw size={13} /> Opdater
        </button>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Indlæser…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">Ingen erklæringer fundet</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(d => {
            const sc = STATUS_CONFIG[d.status] ?? STATUS_CONFIG.PENDING
            const mo = monthsAgo(d.submittedAt || d.updatedAt)
            const isExp = expanded === d.id
            return (
              <div key={d.id} className={`bg-white rounded-xl ring-1 ring-gray-200 overflow-hidden ${urgencyColor(d)}`}>
                <div className="p-4 flex items-center gap-3 flex-wrap cursor-pointer"
                  onClick={() => setExpanded(isExp ? null : d.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800 truncate">{d.companyName || d.bcVendorNo}</span>
                      <span className="text-xs text-gray-400">{d.bcVendorNo}</span>
                      {d.country && <span className="text-xs text-gray-400">{d.country}</span>}
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{LANG_LABELS[d.lang as Lang] ?? d.lang}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                      {d.email && <span>{d.email}</span>}
                      {d.submittedAt && <span>Indsendt: {new Date(d.submittedAt).toLocaleDateString('da-DK')}</span>}
                      {d.nextRenewalDate && <span>Næste: {new Date(d.nextRenewalDate).toLocaleDateString('da-DK')}</span>}
                      {mo < 999 && <span className={mo >= 11 ? 'text-red-500 font-medium' : mo >= 10 ? 'text-yellow-600 font-medium' : ''}>
                        {mo} mdr. siden
                      </span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${sc.color}`}>
                      {sc.icon}{sc.label}
                    </span>
                    {d.documents.length > 0 && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">{d.documents.length} dok.</span>
                    )}
                    {isExp ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </div>

                {/* Detaljer */}
                {isExp && (
                  <div className="border-t border-gray-100 p-4 space-y-4 bg-gray-50">
                    {d.signerName && (
                      <div className="text-sm text-gray-600">
                        <span className="font-medium">Underskrevet af:</span> {d.signerName} ({d.signerTitle}) — {d.signerEmail}
                      </div>
                    )}

                    {d.documents.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1.5">Dokumenter:</p>
                        <div className="flex flex-wrap gap-2">
                          {d.documents.map(doc => (
                            <a key={doc.id} href={`/api/leverandoer/dokument?path=${(doc as any).filePath ?? `uploads/leverandoer/${d.bcVendorNo}/${doc.fileName}`}`}
                              target="_blank" className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 rounded px-2 py-1 hover:bg-blue-100">
                              <FileText size={11} />{doc.docType} — {doc.fileName}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <a href={`/leverandoer/${d.token}?mode=review`} target="_blank"
                        className="flex items-center gap-1.5 text-xs rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600 hover:border-gray-300 bg-white transition">
                        <ExternalLink size={12} /> Åbn formular
                      </a>
                      <button onClick={() => resend(d)} disabled={sending === d.id}
                        className="flex items-center gap-1.5 text-xs rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600 hover:border-gray-300 bg-white transition disabled:opacity-50">
                        <Send size={12} /> Gensend link
                      </button>

                      {d.status === 'SUBMITTED' && (
                        <>
                          <button onClick={() => approve(d.id, 'approve')} disabled={approving === d.id}
                            className="flex items-center gap-1.5 text-xs rounded-lg bg-green-600 px-3 py-1.5 text-white hover:bg-green-700 transition disabled:opacity-50">
                            <CheckCircle2 size={12} /> Godkend
                          </button>
                          <button onClick={() => approve(d.id, 'reject')} disabled={approving === d.id}
                            className="flex items-center gap-1.5 text-xs rounded-lg bg-yellow-500 px-3 py-1.5 text-white hover:bg-yellow-600 transition disabled:opacity-50">
                            <XCircle size={12} /> Returner til revision
                          </button>
                        </>
                      )}
                      {(d.status === 'SUBMITTED' || d.status === 'APPROVED') && (
                        <button onClick={() => approve(d.id, 'reject')} disabled={approving === d.id}
                          className="flex items-center gap-1.5 text-xs rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600 hover:border-gray-300 bg-white transition disabled:opacity-50">
                          <RefreshCw size={12} /> Nulstil til afventer
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Send-link modal */}
      {showSendModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setShowSendModal(false) }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Send erklæringslink til leverandør</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">BC Leverandørnr. <span className="text-red-500">*</span></label>
                <input value={newVendorNo} onChange={e => setNewVendorNo(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Firmanavn</label>
                <input value={newVendorName} onChange={e => setNewVendorName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email <span className="text-red-500">*</span></label>
                <input type="email" value={newVendorEmail} onChange={e => setNewVendorEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Sprog</label>
                <select value={newLang} onChange={e => setNewLang(e.target.value as Lang)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
                  {(['da','sv','en','de','fr','nl','it','es'] as Lang[]).map(l => (
                    <option key={l} value={l}>{LANG_LABELS[l]}</option>
                  ))}
                </select>
              </div>
            </div>
            {sendResult && <p className="text-sm font-medium">{sendResult}</p>}
            <div className="flex gap-2 pt-2">
              <button onClick={sendLink} disabled={sending === 'new' || !newVendorNo || !newVendorEmail}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition">
                <Send size={14} /> {sending === 'new' ? 'Sender…' : 'Send link'}
              </button>
              <button onClick={() => setShowSendModal(false)} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:border-gray-300 transition">
                Luk
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
