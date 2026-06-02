'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { LANGS, LANG_LABELS, getT, type Lang, type Translations } from '@/lib/leverandoer/i18n'
import { Globe, ChevronDown, Upload, CheckCircle2, AlertCircle, Loader2, Plus, X } from 'lucide-react'

const HACCP_KEYS = ['haccpPlan','haccpReview','ccp','training','allergen','foreignBody','labeling']
const SELF_CONTROL_GROUPS: Record<string, string[]> = {
  personnel:   ['personnelHygiene','personnelTraining'],
  facilities:  ['facilityMaintenance','facilityTemperature'],
  cleaning:    ['cleaningProcedure','cleaningVerification'],
  pest:        ['pestContract','pestLog'],
  water:       ['waterQuality','waterFreq'],
  storage:     ['storageTemp','storageFIFO'],
  receiving:   ['receivingControl','receivingTemp'],
  transport:   ['transportCold','transportHygiene'],
  traceability:['traceabilitySystem','traceabilityTest'],
  recall:      ['recallProcedure','recallTest'],
  complaints:  ['complaintsLog','complaintsAction'],
  authority:   ['authorityApproval','authorityValid'],
}
const CERT_TYPE_KEYS = ['ISO22000','FSSC','BRC','IFS','MSC','ASC','GLOBALG','OTHER']
const DOC_TYPE_KEYS  = ['CERT_BRC','CERT_MSC','CERT_OTHER','HACCP','AUDIT','WATER','PEST','RECALL','AUTHORITY','OTHER']

type Answer = 'yes' | 'no' | 'na'
type Answers = Record<string, { val: Answer; comment: string }>

function AnswerToggle({ k, answers, setAnswers, t }: {
  k: string; answers: Answers
  setAnswers: (fn: (a: Answers) => Answers) => void
  t: Translations
}) {
  const cur = answers[k]?.val
  return (
    <div className="space-y-1">
      <div className="flex gap-2 flex-wrap">
        {(['yes','no','na'] as Answer[]).map(opt => (
          <button key={opt} type="button"
            onClick={() => setAnswers(a => ({ ...a, [k]: { ...a[k], val: opt, comment: a[k]?.comment ?? '' } }))}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
              cur === opt
                ? opt === 'yes' ? 'bg-green-100 border-green-400 text-green-800'
                  : opt === 'no' ? 'bg-red-100 border-red-400 text-red-800'
                  : 'bg-gray-200 border-gray-400 text-gray-700'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >{t.answers[opt]}</button>
        ))}
      </div>
      {(cur === 'no' || cur === 'na') && (
        <input type="text" placeholder="Kommentar…"
          value={answers[k]?.comment ?? ''}
          onChange={e => setAnswers(a => ({ ...a, [k]: { ...a[k], comment: e.target.value } }))}
          className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:border-blue-300"
        />
      )}
    </div>
  )
}

export default function LeverandoerFormPage() {
  const { token } = useParams() as { token: string }
  const [lang, setLang]       = useState<Lang>('en')
  const [t, setT]             = useState<Translations>(getT('en'))
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors]   = useState<string[]>([])
  const [decl, setDecl]       = useState<any>(null)

  // Formfelter
  const [fields, setFields] = useState({
    companyName: '', vatNo: '', address: '', country: '', phone: '',
    email: '', contactPerson: '', qualityManager: '', emergencyPhone: '',
    hasThirdPartyCert: false, certTypes: [] as string[], certNumber: '', certExpiry: '',
    hasMsc: false, mscCertNumber: '', mscExpiry: '',
    signerName: '', signerTitle: '', signerEmail: '', confirmed: false,
  })
  const [haccpAnswers, setHaccpAnswers]         = useState<Answers>({})
  const [selfAnswers, setSelfAnswers]           = useState<Answers>({})
  const [docs, setDocs] = useState<{ docType: string; file: File }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/leverandoer/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) { setNotFound(true); return }
        setDecl(d)
        // Vis "Tak" kun ved APPROVED eller SUBMITTED — ikke PENDING (returneret til revision)
        if (d.status === 'APPROVED' || d.status === 'SUBMITTED') setSubmitted(true)
        const l = (d.lang ?? 'en') as Lang
        setLang(l); setT(getT(l))
        setFields(f => ({ ...f, companyName: d.companyName ?? '', email: d.email ?? '' }))
      })
      .finally(() => setLoading(false))
  }, [token])

  function changeLang(l: Lang) { setLang(l); setT(getT(l)) }

  function f(key: keyof typeof fields) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setFields(s => ({ ...s, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  }

  function toggleCert(key: string) {
    setFields(s => ({
      ...s,
      certTypes: s.certTypes.includes(key)
        ? s.certTypes.filter(c => c !== key)
        : [...s.certTypes, key],
    }))
  }

  function addDoc(docType: string, file: File) {
    setDocs(d => [...d, { docType, file }])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: string[] = []
    if (!fields.companyName) errs.push(t.fields.companyName)
    if (!fields.signerName)  errs.push(t.fields.signerName)
    if (!fields.signerEmail) errs.push(t.fields.signerEmail)
    if (!fields.confirmed)   errs.push(t.confirmCheckbox)
    if (errs.length) { setErrors(errs); return }
    setErrors([]); setSubmitting(true)

    const fd = new FormData()
    fd.append('lang', lang)
    Object.entries(fields).forEach(([k, v]) => {
      if (k === 'certTypes') fd.append('certTypes', JSON.stringify(v))
      else if (k !== 'confirmed') fd.append(k, String(v))
    })
    fd.append('haccpAnswers',     JSON.stringify(haccpAnswers))
    fd.append('selfControlAnswers', JSON.stringify(selfAnswers))
    docs.forEach(({ docType, file }) => fd.append(`doc_${docType}`, file, file.name))

    const res = await fetch(`/api/leverandoer/${token}`, { method: 'POST', body: fd })
    if (res.ok) setSubmitted(true)
    else setErrors(['Der opstod en fejl. Prøv igen.'])
    setSubmitting(false)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader2 className="animate-spin text-blue-500" size={32} />
    </div>
  )

  if (notFound) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-2">
        <AlertCircle className="mx-auto text-red-400" size={40} />
        <p className="text-gray-600">Linket er ugyldigt eller udløbet.</p>
      </div>
    </div>
  )

  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md mx-auto text-center space-y-4 p-8">
        <CheckCircle2 className="mx-auto text-green-500" size={48} />
        <h1 className="text-2xl font-bold text-gray-800">{t.successTitle}</h1>
        <p className="text-gray-600">{t.successBody}</p>
        <div className="pt-2">
          <img src="/venmark-logo.png" alt="Venmark Fisk" className="h-10 mx-auto opacity-60" onError={e => (e.currentTarget.style.display='none')} />
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-200 p-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <img src="/venmark-logo.png" alt="Venmark Fisk" className="h-8" onError={e => (e.currentTarget.style.display='none')} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
            <p className="text-sm text-gray-500">{t.subtitle}</p>
            <p className="text-sm text-gray-600 mt-2 max-w-xl">{t.intro}</p>
          </div>
          {/* Sprogvælger */}
          <div className="relative shrink-0">
            <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm cursor-pointer hover:border-gray-300 bg-white">
              <Globe size={14} className="text-gray-400" />
              <select
                value={lang}
                onChange={e => changeLang(e.target.value as Lang)}
                className="appearance-none bg-transparent text-sm text-gray-700 focus:outline-none pr-4 cursor-pointer"
              >
                {LANGS.map(l => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
              </select>
              <ChevronDown size={12} className="text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── 1. Stamdata ── */}
          <Section title={t.sections.stamdata}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t.fields.companyName} required><input type="text" value={fields.companyName} onChange={f('companyName')} className={input} /></Field>
              <Field label={t.fields.vatNo}><input type="text" value={fields.vatNo} onChange={f('vatNo')} className={input} /></Field>
              <Field label={t.fields.address} className="sm:col-span-2"><input type="text" value={fields.address} onChange={f('address')} className={input} /></Field>
              <Field label={t.fields.country}><input type="text" value={fields.country} onChange={f('country')} className={input} /></Field>
              <Field label={t.fields.phone}><input type="tel" value={fields.phone} onChange={f('phone')} className={input} /></Field>
              <Field label={t.fields.email}><input type="email" value={fields.email} onChange={f('email')} className={input} /></Field>
              <Field label={t.fields.contactPerson}><input type="text" value={fields.contactPerson} onChange={f('contactPerson')} className={input} /></Field>
              <Field label={t.fields.qualityManager}><input type="text" value={fields.qualityManager} onChange={f('qualityManager')} className={input} /></Field>
              <Field label={t.fields.emergencyPhone} className="sm:col-span-2"><input type="tel" value={fields.emergencyPhone} onChange={f('emergencyPhone')} className={input} /></Field>
            </div>
          </Section>

          {/* ── 2. Certificeringer ── */}
          <Section title={t.sections.certs}>
            <div className="space-y-4">
              <YesNoField label={t.fields.hasThirdPartyCert} value={fields.hasThirdPartyCert}
                onChange={v => setFields(s => ({ ...s, hasThirdPartyCert: v }))} t={t} />

              {fields.hasThirdPartyCert && (
                <div className="space-y-4 pl-4 border-l-2 border-blue-100">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2">{t.fields.certTypes}</label>
                    <div className="flex flex-wrap gap-2">
                      {CERT_TYPE_KEYS.map(k => (
                        <button key={k} type="button"
                          onClick={() => toggleCert(k)}
                          className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
                            fields.certTypes.includes(k)
                              ? 'bg-blue-100 border-blue-400 text-blue-800'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}
                        >{t.certTypes[k]}</button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label={t.fields.certNumber}><input type="text" value={fields.certNumber} onChange={f('certNumber')} className={input} /></Field>
                    <Field label={t.certExpiry}><input type="date" value={fields.certExpiry} onChange={f('certExpiry')} className={input} /></Field>
                  </div>
                </div>
              )}

              <YesNoField label={t.fields.hasMsc} value={fields.hasMsc}
                onChange={v => setFields(s => ({ ...s, hasMsc: v }))} t={t} />

              {fields.hasMsc && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-4 border-l-2 border-blue-100">
                  <Field label={t.fields.mscCertNumber}><input type="text" value={fields.mscCertNumber} onChange={f('mscCertNumber')} className={input} /></Field>
                  <Field label={t.fields.mscExpiry}><input type="date" value={fields.mscExpiry} onChange={f('mscExpiry')} className={input} /></Field>
                </div>
              )}
            </div>
          </Section>

          {/* ── 3. HACCP ── */}
          <Section title={t.sections.haccp}>
            <div className="space-y-4">
              {HACCP_KEYS.map(k => (
                <div key={k} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
                  <p className="text-sm text-gray-700 pt-1">{t.haccpItems[k]}</p>
                  <AnswerToggle k={k} answers={haccpAnswers} setAnswers={setHaccpAnswers} t={t} />
                </div>
              ))}
            </div>
          </Section>

          {/* ── 4. Egenkontrol ── */}
          <Section title={t.sections.selfControl}>
            <div className="space-y-6">
              {Object.entries(SELF_CONTROL_GROUPS).map(([group, keys]) => (
                <div key={group}>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b border-gray-100">
                    {t.selfControlGroups[group]}
                  </h3>
                  <div className="space-y-3">
                    {keys.map(k => (
                      <div key={k} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
                        <p className="text-sm text-gray-700 pt-1">{t.selfControlItems[k]}</p>
                        <AnswerToggle k={k} answers={selfAnswers} setAnswers={setSelfAnswers} t={t} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── 5. Dokumenter ── */}
          <Section title={t.sections.documents}>
            <div className="space-y-3">
              <p className="text-xs text-gray-500">{t.uploadHint}</p>
              {docs.map((d, i) => (
                <div key={i} className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2">
                  <Upload size={14} className="text-blue-500 shrink-0" />
                  <span className="text-xs text-blue-700 flex-1 truncate">{t.docTypes[d.docType]} — {d.file.name}</span>
                  <button type="button" onClick={() => setDocs(ds => ds.filter((_,j) => j !== i))}>
                    <X size={14} className="text-gray-400 hover:text-red-500" />
                  </button>
                </div>
              ))}
              <DocUploadButton t={t} onAdd={addDoc} docTypeKeys={DOC_TYPE_KEYS} />
            </div>
          </Section>

          {/* ── 6. Godkendelse ── */}
          <Section title={t.sections.confirm}>
            <div className="space-y-4">
              <p className="text-sm text-gray-700 bg-blue-50 rounded-lg p-4 border border-blue-100">{t.confirmText}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label={t.fields.signerName} required><input type="text" value={fields.signerName} onChange={f('signerName')} className={input} /></Field>
                <Field label={t.fields.signerTitle}><input type="text" value={fields.signerTitle} onChange={f('signerTitle')} className={input} /></Field>
                <Field label={t.fields.signerEmail} required className="sm:col-span-2"><input type="email" value={fields.signerEmail} onChange={f('signerEmail')} className={input} /></Field>
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={fields.confirmed} onChange={f('confirmed')} className="mt-0.5 h-4 w-4 accent-blue-600" />
                <span className="text-sm text-gray-700 font-medium">{t.confirmCheckbox}</span>
              </label>
            </div>
          </Section>

          {errors.length > 0 && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm font-medium text-red-700 mb-1">{t.required}:</p>
              <ul className="list-disc list-inside text-sm text-red-600 space-y-0.5">
                {errors.map((e,i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <button type="submit" disabled={submitting}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-4 text-base font-semibold text-white shadow hover:bg-blue-700 active:scale-[0.99] transition disabled:opacity-60"
          >
            {submitting ? <><Loader2 size={18} className="animate-spin" />{t.submitting}</> : t.submit}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 pb-4">Venmark Fisk A/S — {new Date().getFullYear()}</p>
      </div>
    </div>
  )
}

// ── Hjælpekomponenter ─────────────────────────────────────────────────────────

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-200 p-6 space-y-4">
      <h2 className="text-base font-semibold text-gray-800 border-b border-gray-100 pb-2">{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, required, children, className }: {
  label: string; required?: boolean; children: React.ReactNode; className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function YesNoField({ label, value, onChange, t }: {
  label: string; value: boolean
  onChange: (v: boolean) => void; t: Translations
}) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <span className="text-sm text-gray-700 flex-1">{label}</span>
      <div className="flex gap-2">
        <button type="button" onClick={() => onChange(true)}
          className={`rounded-full px-3 py-1 text-xs font-medium border transition ${value ? 'bg-green-100 border-green-400 text-green-800' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
        >{t.answers.yes}</button>
        <button type="button" onClick={() => onChange(false)}
          className={`rounded-full px-3 py-1 text-xs font-medium border transition ${!value ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
        >{t.answers.no}</button>
      </div>
    </div>
  )
}

function DocUploadButton({ t, onAdd, docTypeKeys }: {
  t: Translations; onAdd: (type: string, file: File) => void; docTypeKeys: string[]
}) {
  const [docType, setDocType] = useState(docTypeKeys[0])
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={docType} onChange={e => setDocType(e.target.value)}
        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-300">
        {docTypeKeys.map(k => <option key={k} value={k}>{t.docTypes[k]}</option>)}
      </select>
      <button type="button" onClick={() => ref.current?.click()}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 transition">
        <Plus size={13} />{t.addCert}
      </button>
      <input ref={ref} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) { onAdd(docType, file); e.target.value = '' }
        }}
      />
    </div>
  )
}
