'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { LEGAL, Lang } from '@/lib/kunde/content'

type Variant = 'std' | 'ls'
const DOC_KEYS = ['oc', 'inv', 'cm', 'stmt', 'dn', 'pl'] as const
type DocKey = typeof DOC_KEYS[number]

const RE = { d4: /^\d{4}$/, d8: /^\d{8}$/, d10: /^\d{10}$/, cpr: /^\d{6}-?\d{4}$/, phone: /^\+\d{2,3}[\s\d]{5,}$/ }

const t = (lang: Lang) => (I18N[lang])

const I18N: Record<Lang, Record<string, string>> = {
  da: {
    brand_sub: 'Kundeoprettelse',
    step_company: 'Virksomhed', step_contacts: 'Kontaktpersoner', step_billing: 'Fakturering',
    step_ls: 'Leverandørservice', step_guaranty: 'Selvskyldnerkaution', step_sign: 'Vilkår & underskrift',
    company_h: 'Virksomhedens oplysninger', company_p: 'Grundoplysninger vi bruger til oprettelse, fakturering og kontakt.',
    contacts_h: 'Hvem taler vi med?', contacts_p: 'Kontakt 1 er påkrævet. Mail og telefon bruges bl.a. til tilbagekald, og mailen er samtidig login til bestillingsportalen.',
    billing_h: 'Fakturering & dokument-mails', billing_p: 'Vælg hvem der skal modtage hvilke dokumenter — mindst én mail pr. type.',
    ls_h: 'Tilmelding til Leverandørservice', ls_p: 'Betal automatisk via Leverandørservice. Oplysningerne bruges til betalingsaftalen.',
    guaranty_h: 'Selvskyldnerkaution', guaranty_p: 'En person hæfter personligt for virksomhedens gæld til Venmark. Underskrives til sidst.',
    sign_h: 'Gennemlæs og underskriv', sign_p: 'Læs vilkårene, sæt flueben og underskriv på skærmen. I modtager en kopi som PDF.',
    l_legalname: 'Juridisk navn', l_cvr: 'CVR / VAT-nr.', l_form: 'Virksomhedsform', l_address: 'Adresse',
    l_zip: 'Postnr.', l_city: 'By', l_country: 'Land', l_web: 'Website', l_gln: 'EAN/GLN-nummer',
    l_wantean: 'Vi ønsker faktura som e-faktura (EAN/GLN)',
    l_mainphone: 'Hovedtelefon', l_mainmail: 'Hovedmail', c_name: 'Navn', c_mobile: 'Mobil', c_email: 'Email',
    l_monthly: 'Forventet månedligt indkøb (kr.)', l_pllang: 'Prisliste-sprog',
    billing_note: 'Betalingsbetingelser og kreditmaks fastsættes af Venmark efter kreditvurdering — dem udfylder I ikke her.',
    l_lsconsent: 'Ja, vi tilmelder betaling til Venmark Fisk A/S via Leverandørservice',
    l_bank: 'Pengeinstitut', l_reg: 'Registreringsnr.', l_acc: 'Kontonummer',
    guaranty_note: 'Ubegrænset kaution — kautionisten hæfter for den til enhver tid værende saldo, inkl. renter og omkostninger.',
    l_gname: 'Kautionist — fulde navn', l_gcpr: 'CPR-nummer', l_grel: 'Relation til virksomheden', l_gaddr: 'Privatadresse — vej og nr.',
    l_gconfirm: 'Jeg påtager mig ubegrænset selvskyldnerkaution som beskrevet ovenfor',
    read_guar: 'Læs hele kautionserklæringen',
    c_terms: 'Jeg accepterer Venmarks salgs- og leveringsbetingelser',
    c_gdpr: 'Jeg accepterer behandling af personoplysninger (persondatapolitik)',
    c_auth: 'Jeg er tegningsberettiget og bekræfter at oplysningerne er korrekte',
    c_mkt: 'Ja tak til nyheder og tilbud på mail/SMS',
    l_place: 'Sted', l_date: 'Dato', sig_signer: 'Underskrift — tegningsberettiget', sig_guar: 'Underskrift — kautionist',
    sig_clear: 'Ryd', sig_hint: 'Skriv med finger eller mus', sig_empty: 'Tom', sig_ok: 'Underskrevet',
    legal_terms: 'Salgs- og leveringsbetingelser', legal_gdpr: 'Behandling af personoplysninger (GDPR)', legal_ls: 'Leverandørservice-mandat',
    add_email: '+ Tilføj modtager', dt_oc: 'Ordrebekræftelse', dt_inv: 'Faktura', dt_cm: 'Kreditnota', dt_stmt: 'Kontoudtog', dt_dn: 'Følgeseddel', dt_pl: 'Prisliste',
    nav_back: 'Tilbage', nav_next: 'Næste', nav_send: 'Send og underskriv',
    hint_4dig: '4 cifre', hint_8dig: '8 cifre (dansk CVR)', hint_10dig: '10 cifre', hint_cpr: 'Format: 6 cifre-4 cifre', hint_phone: 'Med landekode, fx +45',
    err_fix: 'Udfyld de felter der er markeret med rødt.', err_format: 'Tjek formatet på de felter der er markeret med rødt.',
    prefill: 'Vi har forudfyldt med jeres nuværende oplysninger. Ret det, der er ændret, og udfyld de tomme felter.',
    done_h: 'Tak — vi har modtaget jeres oplysninger', done_p: 'En kvittering med den underskrevne PDF er sendt til jeres mail. Vi gennemgår oplysningerne og opretter jer som kunde.',
    sending: 'Sender …', notfound: 'Linket er ugyldigt eller udløbet.', loaderr: 'Kunne ikke hente oplysninger. Prøv igen senere.',
    form_sole: 'Enkeltmandsvirksomhed', form_other: 'Andet', rel_owner: 'Ejer', rel_dir: 'Direktør', rel_board: 'Bestyrelse',
  },
  en: {
    brand_sub: 'Customer onboarding',
    step_company: 'Company', step_contacts: 'Contacts', step_billing: 'Invoicing',
    step_ls: 'Direct Debit', step_guaranty: 'Personal guarantee', step_sign: 'Terms & signature',
    company_h: 'Company details', company_p: 'Basic information used for setup, invoicing and contact.',
    contacts_h: 'Who do we talk to?', contacts_p: 'Contact 1 is required. E-mail and phone are used e.g. for recalls, and the e-mail is also the ordering-portal login.',
    billing_h: 'Invoicing & document e-mails', billing_p: 'Choose who receives which documents — at least one e-mail per type.',
    ls_h: 'Direct Debit registration', ls_p: 'Pay automatically via Danish Direct Debit. The details are used for the payment agreement.',
    guaranty_h: 'Personal guarantee', guaranty_p: 'A person is personally liable for the company\'s debt to Venmark. Signed at the end.',
    sign_h: 'Review and sign', sign_p: 'Read the terms, tick the boxes and sign on screen. You will receive a copy as PDF.',
    l_legalname: 'Legal name', l_cvr: 'Company reg./VAT no.', l_form: 'Company type', l_address: 'Address',
    l_zip: 'Postcode', l_city: 'City', l_country: 'Country', l_web: 'Website', l_gln: 'EAN/GLN number',
    l_wantean: 'We want invoices as e-invoice (EAN/GLN)',
    l_mainphone: 'Main phone', l_mainmail: 'Main e-mail', c_name: 'Name', c_mobile: 'Mobile', c_email: 'Email',
    l_monthly: 'Expected monthly purchase (DKK)', l_pllang: 'Price list language',
    billing_note: 'Payment terms and credit limit are set by Venmark after a credit assessment — you do not fill these in here.',
    l_lsconsent: 'Yes, we register payment to Venmark Fisk A/S via Leverandørservice',
    l_bank: 'Bank', l_reg: 'Registration no.', l_acc: 'Account number',
    guaranty_note: 'Unlimited guarantee — the guarantor is liable for the outstanding balance from time to time, incl. interest and costs.',
    l_gname: 'Guarantor — full name', l_gcpr: 'Personal ID (CPR)', l_grel: 'Relation to the company', l_gaddr: 'Home address — street',
    l_gconfirm: 'I undertake unlimited personal guarantee as described above',
    read_guar: 'Read the full guarantee declaration',
    c_terms: 'I accept Venmark\'s terms of sale and delivery',
    c_gdpr: 'I accept the processing of personal data (privacy policy)',
    c_auth: 'I am authorised to sign and confirm the details are correct',
    c_mkt: 'Yes please to news and offers by e-mail/SMS',
    l_place: 'Place', l_date: 'Date', sig_signer: 'Signature — authorised signatory', sig_guar: 'Signature — guarantor',
    sig_clear: 'Clear', sig_hint: 'Draw with finger or mouse', sig_empty: 'Empty', sig_ok: 'Signed',
    legal_terms: 'Terms of sale and delivery', legal_gdpr: 'Processing of personal data (GDPR)', legal_ls: 'Direct Debit mandate',
    add_email: '+ Add recipient', dt_oc: 'Order confirmation', dt_inv: 'Invoice', dt_cm: 'Credit note', dt_stmt: 'Statement', dt_dn: 'Delivery note', dt_pl: 'Price list',
    nav_back: 'Back', nav_next: 'Next', nav_send: 'Submit & sign',
    hint_4dig: '4 digits', hint_8dig: '8 digits (Danish CVR)', hint_10dig: '10 digits', hint_cpr: 'Format: 6 digits-4 digits', hint_phone: 'With country code, e.g. +45',
    err_fix: 'Please complete the fields marked in red.', err_format: 'Please check the format of the fields marked in red.',
    prefill: 'We have pre-filled your current details. Correct anything that has changed and complete the empty fields.',
    done_h: 'Thank you — we have received your details', done_p: 'A receipt with the signed PDF has been sent to your e-mail. We will review your details and set you up as a customer.',
    sending: 'Sending …', notfound: 'The link is invalid or expired.', loaderr: 'Could not load details. Please try again later.',
    form_sole: 'Sole proprietorship', form_other: 'Other', rel_owner: 'Owner', rel_dir: 'Director', rel_board: 'Board',
  },
}

interface Contact { name: string; mobile: string; email: string }

export default function OnboardingPage() {
  const token = String(useParams().token || '')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lang, setLang] = useState<Lang>('da')
  const [variant, setVariant] = useState<Variant>('std')
  const [prefilled, setPrefilled] = useState(false)
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const [f, setF] = useState<Record<string, any>>({
    name: '', vat: '', form: 'ApS', address: '', zip: '', city: '', country: 'Danmark', ean: false, gln: '', website: '',
    phone: '+45 ', mainmail: '', monthly: '', pllang: 'Dansk',
    lsConsent: false, bank: '', reg: '', acc: '',
    gName: '', gCpr: '', gRel: '', gStreet: '', gZip: '', gCity: '', gConfirm: false,
    terms: false, gdpr: false, auth: false, mkt: false, place: '',
  })
  const [contacts, setContacts] = useState<Contact[]>([{ name: '', mobile: '+45 ', email: '' }, { name: '', mobile: '', email: '' }, { name: '', mobile: '', email: '' }])
  const [docEmails, setDocEmails] = useState<Record<DocKey, string[]>>({ oc: [''], inv: [''], cm: [''], stmt: [''], dn: [''], pl: [''] })

  const sig1 = useRef<HTMLCanvasElement>(null)
  const sig2 = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<{ s1: boolean; s2: boolean }>({ s1: false, s2: false })
  const lastPt = useRef<{ s1: { x: number; y: number } | null; s2: { x: number; y: number } | null }>({ s1: null, s2: null })
  const [sigInk, setSigInk] = useState<{ s1: boolean; s2: boolean }>({ s1: false, s2: false })

  const tt = t(lang)
  const isLs = variant === 'ls'
  const steps = ['company', 'contacts', 'billing', ...(isLs ? ['ls', 'guaranty'] : []), 'sign']

  // ---- load prefill ----
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/kunde/${token}`, { cache: 'no-store' })
        if (!res.ok) { if (alive) { setLoadError(res.status === 404 ? 'notfound' : 'loaderr'); setLoading(false) } ; return }
        const r = await res.json()
        if (!alive) return
        setVariant(r.variant === 'Leverandoerservice' ? 'ls' : 'std')
        setLang(r.languageCode === 'en' ? 'en' : 'da')
        const anyData = r.companyName || r.vatRegistrationNo || r.contact1Name
        setPrefilled(!!anyData)
        setF(prev => ({
          ...prev,
          name: r.companyName || '', vat: r.vatRegistrationNo || '', form: r.companyForm || prev.form,
          address: r.address || '', zip: r.postCode || '', city: r.city || '', country: r.countryRegionCode || prev.country,
          ean: !!r.eInvoiceEan, gln: r.gln || '', website: r.website || '',
          phone: r.phoneNo || '+45 ', mainmail: r.email || '',
          monthly: r.expectedMonthlyPurchase ? String(r.expectedMonthlyPurchase) : '',
        }))
        setContacts([
          { name: r.contact1Name || '', mobile: r.contact1Mobile || '+45 ', email: r.contact1Email || '' },
          { name: r.contact2Name || '', mobile: r.contact2Mobile || '', email: r.contact2Email || '' },
          { name: r.contact3Name || '', mobile: r.contact3Mobile || '', email: r.contact3Email || '' },
        ])
        setLoading(false)
      } catch { if (alive) { setLoadError('loaderr'); setLoading(false) } }
    })()
    return () => { alive = false }
  }, [token])

  const clearInvalid = useCallback((key: string) => {
    setInvalid(prev => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n })
  }, [])
  const upd = (key: string, val: any) => { setF(prev => ({ ...prev, [key]: val })); clearInvalid(key) }

  // ---- signature drawing ----
  function sizeCanvas(c: HTMLCanvasElement | null) {
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(c.clientWidth * dpr)) {
      c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr)
      const ctx = c.getContext('2d'); if (ctx) ctx.scale(dpr, dpr)
    }
  }
  useEffect(() => { if (steps[step] === 'sign') { sizeCanvas(sig1.current); sizeCanvas(sig2.current) } }) // eslint-disable-line

  function makeDraw(ref: React.RefObject<HTMLCanvasElement>, which: 's1' | 's2') {
    const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    return {
      onPointerDown: (e: React.PointerEvent) => { drawing.current[which] = true; lastPt.current[which] = pos(e); try { ref.current!.setPointerCapture(e.pointerId) } catch {} },
      onPointerMove: (e: React.PointerEvent) => {
        if (!drawing.current[which]) return
        const ctx = ref.current!.getContext('2d'); const l = lastPt.current[which]; if (!ctx || !l) return
        const p = pos(e)
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink') || '#132029'
        ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(p.x, p.y); ctx.stroke(); lastPt.current[which] = p
        setSigInk(s => (s[which] ? s : { ...s, [which]: true }))
        clearInvalid(which === 's1' ? 'sig1' : 'sig2')
      },
      onPointerUp: (e: React.PointerEvent) => { drawing.current[which] = false; lastPt.current[which] = null; try { ref.current!.releasePointerCapture(e.pointerId) } catch {} },
    }
  }
  function clearSig(ref: React.RefObject<HTMLCanvasElement>, which: 's1' | 's2') {
    const c = ref.current; if (!c) return; const ctx = c.getContext('2d'); ctx?.clearRect(0, 0, c.width, c.height)
    setSigInk(s => ({ ...s, [which]: false }))
  }

  // ---- validation ----
  function validate(stepId: string): { keys: Set<string>; format: boolean; missing: boolean } {
    const keys = new Set<string>(); let format = false; let missing = false
    const need = (k: string, v: string) => { if (!v || !v.trim()) { keys.add(k); missing = true } }
    const fmt = (k: string, v: string, re: RegExp) => { if (v && v.trim() && !re.test(v.trim())) { keys.add(k); format = true } }
    if (stepId === 'company') {
      need('name', f.name); need('vat', f.vat); need('address', f.address); need('zip', f.zip); need('city', f.city)
      if (f.ean) need('gln', f.gln)
      fmt('vat', f.vat, RE.d8); fmt('zip', f.zip, RE.d4)
    }
    if (stepId === 'contacts') {
      need('cn1', contacts[0].name); need('cm1', contacts[0].mobile); need('ce1', contacts[0].email)
      fmt('cm1', contacts[0].mobile, RE.phone); fmt('cm2', contacts[1].mobile, RE.phone); fmt('cm3', contacts[2].mobile, RE.phone)
      fmt('phone', f.phone, RE.phone)
    }
    if (stepId === 'billing') {
      for (const k of DOC_KEYS) { if (!docEmails[k].some(e => e.trim())) { keys.add('doc_' + k); missing = true } }
    }
    if (stepId === 'ls') { if (!f.lsConsent) { keys.add('lsConsent'); missing = true } need('bank', f.bank); need('reg', f.reg); need('acc', f.acc); fmt('reg', f.reg, RE.d4); fmt('acc', f.acc, RE.d10) }
    if (stepId === 'guaranty') {
      need('gName', f.gName); need('gCpr', f.gCpr); need('gStreet', f.gStreet); need('gZip', f.gZip); need('gCity', f.gCity)
      if (!f.gConfirm) { keys.add('gConfirm'); missing = true }
      fmt('gCpr', f.gCpr, RE.cpr); fmt('gZip', f.gZip, RE.d4)
    }
    if (stepId === 'sign') {
      if (!f.terms) { keys.add('cTerms'); missing = true } if (!f.gdpr) { keys.add('cGdpr'); missing = true } if (!f.auth) { keys.add('cAuth'); missing = true }
      if (!sigInk.s1) { keys.add('sig1'); missing = true } if (isLs && !sigInk.s2) { keys.add('sig2'); missing = true }
    }
    return { keys, format, missing }
  }

  function next() {
    const cur = steps[step]
    const { keys, format, missing } = validate(cur)
    if (keys.size) { setInvalid(keys); setErrMsg(!missing && format ? tt.err_format : tt.err_fix); setTimeout(() => setErrMsg(null), 4500); return }
    setInvalid(new Set()); setErrMsg(null)
    if (cur === 'sign') { submit(); return }
    setStep(s => Math.min(s + 1, steps.length - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function back() { setStep(s => Math.max(0, s - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  async function submit() {
    setSubmitting(true)
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const payload = {
      lang, variant,
      company: { name: f.name, vat: f.vat, form: f.form, address: f.address, postCode: f.zip, city: f.city, country: f.country, eInvoiceEan: f.ean, gln: f.gln, website: f.website },
      contacts: contacts.map(c => ({ name: c.name, mobile: c.mobile, email: c.email })),
      phoneNo: f.phone, email: f.mainmail,
      docEmails: DOC_KEYS.map(k => ({ type: k, emails: docEmails[k].filter(e => e.trim()) })),
      monthly: f.monthly, prislisteSprog: f.pllang,
      ls: isLs ? { consent: f.lsConsent, bank: f.bank, reg: f.reg, acc: f.acc } : undefined,
      guarantor: isLs ? { name: f.gName, cpr: f.gCpr, addressStreet: f.gStreet, zip: f.gZip, city: f.gCity } : undefined,
      consents: { terms: f.terms, gdpr: f.gdpr, marketing: f.mkt, authorized: f.auth },
      signPlace: f.place, signDate: iso, signerName: contacts[0].name || f.name,
      sig1: sigInk.s1 ? sig1.current?.toDataURL('image/png') : undefined,
      sig2: isLs && sigInk.s2 ? sig2.current?.toDataURL('image/png') : undefined,
    }
    try {
      const res = await fetch(`/api/kunde/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error()
      setDone(true); window.scrollTo({ top: 0 })
    } catch {
      setErrMsg(lang === 'da' ? 'Indsendelse fejlede — prøv igen.' : 'Submission failed — please try again.'); setTimeout(() => setErrMsg(null), 5000)
    } finally { setSubmitting(false) }
  }

  const inv = (k: string) => invalid.has(k) ? ' invalid' : ''

  // ---- doc email helpers ----
  const addEmail = (k: DocKey) => setDocEmails(p => ({ ...p, [k]: [...p[k], ''] }))
  const setEmail = (k: DocKey, i: number, v: string) => setDocEmails(p => { const a = [...p[k]]; a[i] = v; return { ...p, [k]: a } })
  const rmEmail = (k: DocKey, i: number) => setDocEmails(p => { const a = p[k].length > 1 ? p[k].filter((_, j) => j !== i) : [''] ; return { ...p, [k]: a } })

  const setContact = (i: number, key: keyof Contact, v: string) => { setContacts(p => { const a = [...p]; a[i] = { ...a[i], [key]: v }; return a }); clearInvalid(['cn', 'cm', 'ce'][['name', 'mobile', 'email'].indexOf(key)] + (i + 1)) }

  if (loading) return <div className="wrap"><style dangerouslySetInnerHTML={{ __html: CSS }} /><div className="center">…</div></div>
  if (loadError) return <div className="wrap"><style dangerouslySetInnerHTML={{ __html: CSS }} /><div className="center">{loadError === 'notfound' ? tt.notfound : tt.loaderr}</div></div>

  return (
    <div className="wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="topbar">
        <div className="brand">
          <svg className="wave" viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#12808f" /><path d="M4 20c3 0 3-3 6-3s3 3 6 3 3-3 6-3 3 3 6 3" stroke="#eaf4fa" strokeWidth="2" strokeLinecap="round" /><path d="M4 14c3 0 3-3 6-3s3 3 6 3 3-3 6-3 3 3 6 3" stroke="#9fd6de" strokeWidth="1.6" strokeLinecap="round" opacity=".8" /></svg>
          <div><div className="brand-name">Venmark Fisk A/S</div><div className="brand-sub">{tt.brand_sub}</div></div>
        </div>
        <div className="seg" role="group" aria-label="Language">
          <button aria-pressed={lang === 'da'} onClick={() => setLang('da')}>DA</button>
          <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        </div>
      </div>

      <div className="shell">
        <nav className="rail" aria-label="Trin">
          <ol>
            {steps.map((s, i) => (
              <li key={s} aria-current={i === step ? 'true' : undefined} className={i < step ? 'done' : ''} onClick={() => i <= step && setStep(i)}>
                <span className="r-num"><span>{i < step ? '' : i + 1}</span></span>
                <span className="r-label">{tt['step_' + s]}</span>
              </li>
            ))}
          </ol>
        </nav>

        <main className="stage">
          {done ? (
            <div className="card"><div className="done-screen">
              <div className="seal"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M20 6 9 17l-5-5" /></svg></div>
              <h2>{tt.done_h}</h2><p>{tt.done_p}</p>
            </div></div>
          ) : (<>
            {step === 0 && prefilled && <div className="prefill">{tt.prefill}</div>}
            <div className="card">
              {steps[step] === 'company' && (
                <Section eyebrow={tt.step_company} h={tt.company_h} p={tt.company_p}>
                  <div className="grid">
                    <F full lbl={tt.l_legalname} req><input className={'in' + inv('name')} value={f.name} onChange={e => upd('name', e.target.value)} /></F>
                    <F lbl={tt.l_cvr} req hint={tt.hint_8dig}><input className={'in mono' + inv('vat')} inputMode="numeric" maxLength={8} value={f.vat} onChange={e => upd('vat', e.target.value)} /></F>
                    <F lbl={tt.l_form} req><select className="in" value={f.form} onChange={e => upd('form', e.target.value)}><option>ApS</option><option>A/S</option><option>I/S</option><option>{tt.form_sole}</option><option>{tt.form_other}</option></select></F>
                    <F full lbl={tt.l_address} req><input className={'in' + inv('address')} value={f.address} onChange={e => upd('address', e.target.value)} /></F>
                    <F lbl={tt.l_zip} req hint={tt.hint_4dig}><input className={'in mono' + inv('zip')} inputMode="numeric" maxLength={4} style={{ maxWidth: 120 }} value={f.zip} onChange={e => upd('zip', e.target.value)} /></F>
                    <F lbl={tt.l_city} req><input className={'in' + inv('city')} value={f.city} onChange={e => upd('city', e.target.value)} /></F>
                    <F lbl={tt.l_country} req><select className="in" value={f.country} onChange={e => upd('country', e.target.value)}><option>Danmark</option><option>Sverige</option><option>Deutschland</option><option>Nederland</option></select></F>
                    <F full><label className="check"><input type="checkbox" checked={f.ean} onChange={e => upd('ean', e.target.checked)} /><span className="c-text">{tt.l_wantean}</span></label></F>
                    {f.ean && <F full lbl={tt.l_gln} req><input className={'in mono' + inv('gln')} inputMode="numeric" placeholder="5790000000000" value={f.gln} onChange={e => upd('gln', e.target.value)} /></F>}
                    <F lbl={tt.l_web}><input className="in" value={f.website} onChange={e => upd('website', e.target.value)} /></F>
                  </div>
                </Section>
              )}

              {steps[step] === 'contacts' && (
                <Section eyebrow={tt.step_contacts} h={tt.contacts_h} p={tt.contacts_p}>
                  <div className="grid">
                    <F lbl={tt.l_mainphone} hint={tt.hint_phone}><input className={'in mono' + inv('phone')} value={f.phone} onChange={e => upd('phone', e.target.value)} /></F>
                    <F lbl={tt.l_mainmail}><input className="in" type="email" value={f.mainmail} onChange={e => upd('mainmail', e.target.value)} /></F>
                  </div>
                  {contacts.map((c, i) => (
                    <div className="contact-block" key={i}>
                      <div className="cb-title"><span className="dot">{i + 1}</span>{`${lang === 'da' ? 'Kontakt' : 'Contact'} ${i + 1}`}</div>
                      <div className="grid">
                        <F lbl={tt.c_name} req={i === 0}><input className={'in' + (i === 0 ? inv('cn1') : '')} value={c.name} onChange={e => setContact(i, 'name', e.target.value)} /></F>
                        <F lbl={tt.c_mobile} req={i === 0} hint={tt.hint_phone}><input className={'in mono' + (i === 0 ? inv('cm1') : '') + (invalid.has('cm' + (i + 1)) ? ' invalid' : '')} value={c.mobile} onChange={e => setContact(i, 'mobile', e.target.value)} /></F>
                        <F full lbl={tt.c_email} req={i === 0} hint={lang === 'da' ? 'Bruges også som portal-login' : 'Also used as portal login'}><input className={'in' + (i === 0 ? inv('ce1') : '')} type="email" value={c.email} onChange={e => setContact(i, 'email', e.target.value)} /></F>
                      </div>
                    </div>
                  ))}
                </Section>
              )}

              {steps[step] === 'billing' && (
                <Section eyebrow={tt.step_billing} h={tt.billing_h} p={tt.billing_p}>
                  <div className="grid">
                    <F lbl={tt.l_monthly}><input className="in mono" type="number" value={f.monthly} onChange={e => upd('monthly', e.target.value)} /></F>
                    <F lbl={tt.l_pllang}><select className="in" value={f.pllang} onChange={e => upd('pllang', e.target.value)}><option>Dansk</option><option>English</option><option>Deutsch</option></select></F>
                  </div>
                  <div className="note">{tt.billing_note}</div>
                  <div>
                    {DOC_KEYS.map(k => (
                      <div className={'doctype' + (invalid.has('doc_' + k) ? ' invalid' : '')} key={k}>
                        <div className="doctype-head"><b>{tt['dt_' + k]}</b> <span className="req">*</span></div>
                        {docEmails[k].map((em, i) => (
                          <div className="email-row" key={i}>
                            <input className="in" type="email" placeholder="navn@firma.dk" value={em} onChange={e => { setEmail(k, i, e.target.value); clearInvalid('doc_' + k) }} />
                            <button type="button" className="icon-btn" onClick={() => rmEmail(k, i)} aria-label="Fjern">×</button>
                          </div>
                        ))}
                        <button type="button" className="add-btn" onClick={() => addEmail(k)}>{tt.add_email}</button>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {steps[step] === 'ls' && (
                <Section eyebrow={tt.step_ls} h={tt.ls_h} p={tt.ls_p}>
                  <label className={'check' + (invalid.has('lsConsent') ? ' invalid' : '')}><input type="checkbox" checked={f.lsConsent} onChange={e => upd('lsConsent', e.target.checked)} /><span className="c-text">{tt.l_lsconsent} <span className="req">*</span></span></label>
                  <div className="grid">
                    <F full lbl={tt.l_bank} req><input className={'in' + inv('bank')} value={f.bank} onChange={e => upd('bank', e.target.value)} /></F>
                    <F lbl={tt.l_reg} req hint={tt.hint_4dig}><input className={'in mono' + inv('reg')} inputMode="numeric" maxLength={4} style={{ maxWidth: 120 }} value={f.reg} onChange={e => upd('reg', e.target.value)} /></F>
                    <F lbl={tt.l_acc} req hint={tt.hint_10dig}><input className={'in mono' + inv('acc')} inputMode="numeric" maxLength={10} value={f.acc} onChange={e => upd('acc', e.target.value)} /></F>
                  </div>
                </Section>
              )}

              {steps[step] === 'guaranty' && (
                <Section eyebrow={tt.step_guaranty} h={tt.guaranty_h} p={tt.guaranty_p}>
                  <div className="note note-warn">{tt.guaranty_note}</div>
                  <details className="legal"><summary>{tt.read_guar}</summary><div className="legal-body" dangerouslySetInnerHTML={{ __html: LEGAL[lang].guar }} /></details>
                  <div className="grid">
                    <F full lbl={tt.l_gname} req><input className={'in' + inv('gName')} value={f.gName} onChange={e => upd('gName', e.target.value)} /></F>
                    <F lbl={tt.l_gcpr} req hint={tt.hint_cpr}><input className={'in mono' + inv('gCpr')} maxLength={11} placeholder="000000-0000" value={f.gCpr} onChange={e => upd('gCpr', e.target.value)} /></F>
                    <F lbl={tt.l_grel}><select className="in" value={f.gRel} onChange={e => upd('gRel', e.target.value)}><option>{tt.rel_owner}</option><option>{tt.rel_dir}</option><option>{tt.rel_board}</option><option>{tt.form_other}</option></select></F>
                    <F full lbl={tt.l_gaddr} req><input className={'in' + inv('gStreet')} value={f.gStreet} onChange={e => upd('gStreet', e.target.value)} /></F>
                    <F lbl={tt.l_zip} req hint={tt.hint_4dig}><input className={'in mono' + inv('gZip')} inputMode="numeric" maxLength={4} style={{ maxWidth: 120 }} value={f.gZip} onChange={e => upd('gZip', e.target.value)} /></F>
                    <F lbl={tt.l_city} req><input className={'in' + inv('gCity')} value={f.gCity} onChange={e => upd('gCity', e.target.value)} /></F>
                  </div>
                  <label className={'check' + (invalid.has('gConfirm') ? ' invalid' : '')}><input type="checkbox" checked={f.gConfirm} onChange={e => upd('gConfirm', e.target.checked)} /><span className="c-text">{tt.l_gconfirm} <span className="req">*</span></span></label>
                </Section>
              )}

              {steps[step] === 'sign' && (
                <Section eyebrow={tt.step_sign} h={tt.sign_h} p={tt.sign_p}>
                  <details className="legal" open><summary>{tt.legal_terms}</summary><div className="legal-body" dangerouslySetInnerHTML={{ __html: LEGAL[lang].terms }} /></details>
                  <details className="legal"><summary>{tt.legal_gdpr}</summary><div className="legal-body" dangerouslySetInnerHTML={{ __html: LEGAL[lang].gdpr }} /></details>
                  {isLs && <details className="legal"><summary>{tt.legal_ls}</summary><div className="legal-body" dangerouslySetInnerHTML={{ __html: LEGAL[lang].ls }} /></details>}

                  <div className="consents">
                    <label className={'check' + (invalid.has('cTerms') ? ' invalid' : '')}><input type="checkbox" checked={f.terms} onChange={e => upd('terms', e.target.checked)} /><span className="c-text">{tt.c_terms} <span className="req">*</span></span></label>
                    <label className={'check' + (invalid.has('cGdpr') ? ' invalid' : '')}><input type="checkbox" checked={f.gdpr} onChange={e => upd('gdpr', e.target.checked)} /><span className="c-text">{tt.c_gdpr} <span className="req">*</span></span></label>
                    <label className={'check' + (invalid.has('cAuth') ? ' invalid' : '')}><input type="checkbox" checked={f.auth} onChange={e => upd('auth', e.target.checked)} /><span className="c-text">{tt.c_auth} <span className="req">*</span></span></label>
                    <label className="check"><input type="checkbox" checked={f.mkt} onChange={e => upd('mkt', e.target.checked)} /><span className="c-text">{tt.c_mkt}</span></label>
                  </div>

                  <div className="grid">
                    <F lbl={tt.l_place}><input className="in" value={f.place} onChange={e => upd('place', e.target.value)} /></F>
                    <F lbl={tt.l_date}><input className="in mono" readOnly value={new Date().toLocaleDateString('da-DK')} /></F>
                  </div>

                  <div className="sigwrap">
                    <div className={'sigpad' + (invalid.has('sig1') ? ' invalid' : '')}>
                      <div className="sig-label"><span>{tt.sig_signer}</span><span className={'sig-status' + (sigInk.s1 ? ' ok' : '')}>{sigInk.s1 ? tt.sig_ok : tt.sig_empty}</span></div>
                      <canvas ref={sig1} {...makeDraw(sig1, 's1')} />
                      <div className="sig-base"><span>{tt.sig_hint}</span><button type="button" className="clear-sig" onClick={() => clearSig(sig1, 's1')}>{tt.sig_clear}</button></div>
                    </div>
                    {isLs && (
                      <div className={'sigpad' + (invalid.has('sig2') ? ' invalid' : '')}>
                        <div className="sig-label"><span>{tt.sig_guar}</span><span className={'sig-status' + (sigInk.s2 ? ' ok' : '')}>{sigInk.s2 ? tt.sig_ok : tt.sig_empty}</span></div>
                        <canvas ref={sig2} {...makeDraw(sig2, 's2')} />
                        <div className="sig-base"><span>{tt.sig_hint}</span><button type="button" className="clear-sig" onClick={() => clearSig(sig2, 's2')}>{tt.sig_clear}</button></div>
                      </div>
                    )}
                  </div>
                </Section>
              )}
            </div>
          </>)}
        </main>
      </div>

      {errMsg && <div className="errtoast">{errMsg}</div>}

      {!done && (
        <div className="footer"><div className="footer-in">
          <button className="btn btn-ghost" onClick={back} disabled={step === 0 || submitting}>{tt.nav_back}</button>
          <div className="progressbar"><i style={{ width: `${Math.round((step / steps.length) * 100)}%` }} /></div>
          <button className="btn btn-primary" onClick={next} disabled={submitting}>{submitting ? tt.sending : (steps[step] === 'sign' ? tt.nav_send : tt.nav_next)}</button>
        </div></div>
      )}
    </div>
  )
}

function Section({ eyebrow, h, p, children }: { eyebrow: string; h: string; p: string; children: React.ReactNode }) {
  return (<><div className="card-head"><div className="eyebrow">{eyebrow}</div><h2>{h}</h2><p>{p}</p></div><div className="card-body">{children}</div></>)
}
function F({ lbl, req, hint, full, children }: { lbl?: string; req?: boolean; hint?: string; full?: boolean; children: React.ReactNode }) {
  return (<div className={'field' + (full ? ' full' : '')}>{lbl && <label>{lbl}{req && <span className="req"> *</span>}</label>}{children}{hint && <div className="hint">{hint}</div>}</div>)
}

const CSS = `
:root{--bg:#e9eef1;--surface:#fff;--surface-2:#f4f8f9;--surface-3:#eaf1f3;--ink:#132029;--ink-soft:#4c5f69;--ink-faint:#778992;--line:#d6e0e4;--line-strong:#bccad0;--navy:#0b3d5c;--navy-ink:#0b3d5c;--sea:#12808f;--sea-deep:#0f6c78;--good:#2f9e5f;--warn:#b9760a;--warn-bg:#fdf3e2;--danger:#c0392b;--on-navy:#eaf4fa;--shadow:0 1px 2px rgba(11,61,92,.06),0 8px 24px rgba(11,61,92,.08);--radius:12px;--radius-sm:8px}
:root:not([data-theme="light"]){@media (prefers-color-scheme:dark){--bg:#0b1418;--surface:#132029;--surface-2:#182a34;--surface-3:#1e3541;--ink:#e6eef2;--ink-soft:#a6b8c1;--ink-faint:#7d919b;--line:#274049;--line-strong:#375059;--navy:#5fb0d6;--navy-ink:#bfe0f1;--sea:#3bb9c6;--sea-deep:#59c8d3;--good:#4cc07e;--warn:#e6a94b;--warn-bg:#2e2415;--danger:#e5705f;--on-navy:#eaf4fa;--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35)}}
:root[data-theme="dark"]{--bg:#0b1418;--surface:#132029;--surface-2:#182a34;--surface-3:#1e3541;--ink:#e6eef2;--ink-soft:#a6b8c1;--ink-faint:#7d919b;--line:#274049;--line-strong:#375059;--navy:#5fb0d6;--navy-ink:#bfe0f1;--sea:#3bb9c6;--sea-deep:#59c8d3;--good:#4cc07e;--warn:#e6a94b;--warn-bg:#2e2415;--danger:#e5705f;--on-navy:#eaf4fa;--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35)}
*{box-sizing:border-box}
.wrap{background:var(--bg);color:var(--ink);font-family:"IBM Plex Sans",system-ui,Arial,sans-serif;font-size:15px;line-height:1.5;min-height:100vh}
.center{display:grid;place-items:center;min-height:60vh;color:var(--ink-soft)}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace}
.topbar{position:sticky;top:0;z-index:30;background:#0b2233;color:var(--on-navy);display:flex;align-items:center;gap:16px;padding:12px clamp(16px,4vw,32px);flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:11px;margin-right:auto}.brand .wave{width:30px;height:30px}
.brand-name{font-weight:700;font-size:18px;color:#fff}.brand-sub{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9fc6dd}
.seg{display:inline-flex;background:rgba(255,255,255,.1);border-radius:999px;padding:3px;border:1px solid rgba(255,255,255,.14)}
.seg button{border:0;background:transparent;color:#cfe3f0;cursor:pointer;font:inherit;font-size:13px;font-weight:500;padding:5px 13px;border-radius:999px}
.seg button[aria-pressed="true"]{background:#fff;color:#0b2233;font-weight:600}
.shell{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:264px 1fr;gap:28px;padding:28px clamp(16px,4vw,32px) 120px}
@media(max-width:860px){.shell{grid-template-columns:1fr;gap:0;padding-top:0}}
.rail{position:sticky;top:84px;align-self:start}
@media(max-width:860px){.rail{position:sticky;top:57px;z-index:20;background:var(--bg);margin:0 calc(-1*clamp(16px,4vw,32px));padding:10px clamp(16px,4vw,32px);border-bottom:1px solid var(--line)}}
.rail ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
@media(max-width:860px){.rail ol{flex-direction:row;gap:6px;overflow-x:auto}}
.rail li{display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:var(--radius-sm);color:var(--ink-soft);cursor:pointer;font-size:14px;font-weight:500}
.rail li[aria-current="true"]{background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
@media(max-width:860px){.rail li{flex-direction:column;gap:5px;padding:5px 6px;font-size:11px;min-width:64px;text-align:center;white-space:nowrap}}
.r-num{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:600;background:var(--surface-3);color:var(--ink-soft);border:1.5px solid var(--line-strong)}
.rail li[aria-current="true"] .r-num{background:var(--sea);color:#fff;border-color:var(--sea)}
.rail li.done .r-num{background:var(--good);color:#fff;border-color:var(--good)}
.rail li.done .r-num::after{content:"✓"}
.stage{min-width:0}
.prefill{background:var(--surface-3);border:1px solid var(--line);border-left:3px solid var(--sea);border-radius:var(--radius-sm);padding:12px 15px;margin-bottom:20px;font-size:13.5px;color:var(--ink-soft)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:clip}
.card-head{padding:22px clamp(18px,3vw,30px) 0}
.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--sea-deep);font-weight:600}
.card-head h2{font-weight:700;font-size:clamp(21px,3vw,26px);margin:6px 0 4px;color:var(--navy-ink)}
.card-head p{margin:0;color:var(--ink-soft);font-size:14px;max-width:60ch}
.card-body{padding:20px clamp(18px,3vw,30px) 28px;display:flex;flex-direction:column;gap:20px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px}.grid .full{grid-column:1/-1}
@media(max-width:560px){.grid{grid-template-columns:1fr}}
.field{display:flex;flex-direction:column;gap:5px;min-width:0}
.field>label{font-size:13px;font-weight:600;color:var(--ink)}
.req{color:var(--danger);font-weight:700}
.hint{font-size:12px;color:var(--ink-faint)}
.in{font:inherit;font-size:14.5px;color:var(--ink);background:var(--surface-2);border:1.5px solid var(--line-strong);border-radius:var(--radius-sm);padding:9px 11px;width:100%}
.in:focus{outline:none;border-color:var(--sea);box-shadow:0 0 0 3px color-mix(in srgb,var(--sea) 22%,transparent)}
select.in{appearance:none}
.in.invalid{border-color:var(--danger);background:color-mix(in srgb,var(--danger) 7%,var(--surface-2));box-shadow:0 0 0 3px color-mix(in srgb,var(--danger) 16%,transparent)}
.check{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:var(--ink);cursor:pointer}
.check input{margin:2px 0 0;width:17px;height:17px;accent-color:var(--sea);flex:none}
.check.invalid{color:var(--danger)}.check.invalid input{outline:2px solid var(--danger);outline-offset:1px}
.consents{display:flex;flex-direction:column;gap:12px;border:1px solid var(--line);border-radius:var(--radius-sm);padding:15px 16px}
.contact-block{padding:15px 16px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2)}
.contact-block+.contact-block{margin-top:12px}
.cb-title{font-weight:700;font-size:13px;color:var(--navy-ink);margin:0 0 12px;display:flex;align-items:center;gap:8px}
.cb-title .dot{width:22px;height:22px;border-radius:50%;background:var(--surface-3);color:var(--sea-deep);display:grid;place-items:center;font-size:12px;font-weight:700}
.note{background:var(--surface-3);border:1px solid var(--line);border-radius:var(--radius-sm);padding:12px 14px;font-size:13px;color:var(--ink-soft)}
.note-warn{background:var(--warn-bg);border-color:color-mix(in srgb,var(--warn) 35%,transparent)}
.doctype{border:1px solid var(--line);border-radius:var(--radius-sm);padding:13px 15px}.doctype+.doctype{margin-top:10px}
.doctype.invalid{border-color:var(--danger)}
.doctype-head{margin-bottom:9px;font-size:13.5px}
.email-row{display:flex;gap:8px;margin-bottom:7px}.email-row .in{flex:1}
.icon-btn{flex:none;border:1.5px solid var(--line-strong);background:var(--surface-2);color:var(--ink-soft);border-radius:var(--radius-sm);width:38px;cursor:pointer;font-size:17px}
.add-btn{border:1px dashed var(--line-strong);background:transparent;color:var(--sea-deep);font:inherit;font-size:13px;font-weight:600;border-radius:var(--radius-sm);padding:7px 12px;cursor:pointer}
.legal{border:1px solid var(--line);border-radius:var(--radius-sm);overflow:clip}.legal+.legal{margin-top:10px}
.legal>summary{cursor:pointer;padding:13px 15px;font-weight:600;font-size:14px;color:var(--navy-ink);background:var(--surface-2);list-style:none}
.legal>summary::-webkit-details-marker{display:none}
.legal>summary::before{content:"＋";color:var(--sea-deep);font-weight:700;margin-right:8px}.legal[open]>summary::before{content:"－"}
.legal .legal-body{padding:4px 16px 16px;max-height:260px;overflow-y:auto;font-size:13px;color:var(--ink-soft);line-height:1.55}
.legal .legal-body h4{color:var(--ink);font-size:13px;margin:12px 0 3px}.legal .legal-body p{margin:0 0 8px}
.sigwrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.sigpad{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2);padding:12px}
.sigpad.invalid{border-color:var(--danger)}
.sig-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--sea-deep);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
.sigpad canvas{width:100%;height:150px;background:repeating-linear-gradient(transparent 0 28px,color-mix(in srgb,var(--line) 60%,transparent) 28px 29px);border:1.5px dashed var(--line-strong);border-radius:6px;touch-action:none;cursor:crosshair;display:block}
.sig-base{display:flex;align-items:center;justify-content:space-between;margin-top:7px;font-size:12px;color:var(--ink-faint)}
.clear-sig{border:0;background:transparent;color:var(--sea-deep);font:inherit;font-size:12px;font-weight:600;cursor:pointer;text-decoration:underline}
.sig-status{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--surface-3);color:var(--ink-faint)}
.sig-status.ok{background:color-mix(in srgb,var(--good) 18%,transparent);color:var(--good)}
.footer{position:fixed;bottom:0;left:0;right:0;z-index:25;background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(8px);border-top:1px solid var(--line)}
.footer-in{max-width:1120px;margin:0 auto;display:flex;align-items:center;gap:14px;padding:12px clamp(16px,4vw,32px)}
.progressbar{flex:1;height:6px;background:var(--surface-3);border-radius:999px;overflow:hidden}
.progressbar i{display:block;height:100%;background:linear-gradient(90deg,var(--sea),var(--sea-deep));border-radius:999px;transition:width .3s}
.btn{font:inherit;font-weight:600;font-size:14.5px;border-radius:var(--radius-sm);padding:10px 20px;cursor:pointer;border:1.5px solid transparent}
.btn-ghost{background:transparent;border-color:var(--line-strong);color:var(--ink)}.btn-ghost:disabled{opacity:.4;cursor:not-allowed}
.btn-primary{background:var(--sea);color:#fff}.btn-primary:disabled{opacity:.7}
.errtoast{position:fixed;left:50%;transform:translateX(-50%);bottom:76px;z-index:40;background:var(--danger);color:#fff;font-size:13.5px;font-weight:500;padding:11px 16px;border-radius:10px;box-shadow:var(--shadow);max-width:92vw}
.done-screen{text-align:center;padding:44px 24px 52px}
.done-screen .seal{width:74px;height:74px;margin:0 auto 18px;border-radius:50%;background:color-mix(in srgb,var(--good) 16%,transparent);display:grid;place-items:center;color:var(--good)}
.done-screen h2{font-size:26px;color:var(--navy-ink);margin:0 0 8px}.done-screen p{color:var(--ink-soft);max-width:46ch;margin:0 auto}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`
