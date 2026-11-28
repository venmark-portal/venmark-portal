import { NextResponse } from 'next/server'
import {
  udlaegBrugerFraSession, hentKonti, hentFirmakort, hentBilagsmail,
  findDubletter, opretUdlaeg, markerMailet,
} from '@/lib/udlaeg'
import { lavUdlaegPdf } from '@/lib/udlaegPdf'
import { sendEmail } from '@/lib/email'
import { hentMedarbejder } from '@/lib/medarbejder'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const fejl = (tekst: string, status = 400) => NextResponse.json({ fejl: tekst }, { status })

export async function POST(req: Request) {
  const bruger = await udlaegBrugerFraSession()
  if (!bruger) return fejl('Du har ikke adgang til at sende bilag.', 403)

  const b = await req.json().catch(() => null)
  if (!b) return fejl('Ugyldig forespørgsel.')

  const billeder: string[] = Array.isArray(b.billeder)
    ? b.billeder.filter((s: unknown) => typeof s === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(s as string))
    : []
  const dato = String(b.dato ?? '')
  const beloeb = Number(b.beloeb)
  const moms = Number(b.moms) || 0
  const valuta = String(b.valuta || 'DKK').toUpperCase().slice(0, 3)
  const butik = String(b.butik ?? '').trim()
  const formaal = String(b.formaal ?? '').trim()
  const deltagere = String(b.deltagere ?? '').trim()
  const kontoNr = String(b.kontoNr ?? '')          // '' = Ved ikke
  const kortKode = String(b.kortKode ?? '')        // '' = privat udlæg

  if (billeder.length === 0) return fejl('Tag mindst ét billede af kvitteringen.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) return fejl('Udfyld købsdatoen.')
  if (!(beloeb > 0)) return fejl('Udfyld beløbet inkl. moms.')
  if (moms < 0 || moms > beloeb) return fejl('Momsen kan ikke være større end beløbet.')
  if (!butik) return fejl('Udfyld butik/leverandør.')
  if (!formaal) return fejl('Skriv kort hvad udgiften var til.')

  try {
    const [konti, kortListe, bilagsmail] = await Promise.all([
      hentKonti(), hentFirmakort(bruger.vendorNo), hentBilagsmail(),
    ])
    if (!bilagsmail) return fejl('Bilagsmail er ikke sat op i BC (Venmark Opsætning). Kontakt bogholderiet.', 409)

    const konto = kontoNr ? konti.find(k => k.kontoNr === kontoNr) : null
    if (kontoNr && !konto) return fejl('Den valgte konto findes ikke længere. Vælg igen.')
    if (konto?.repraesentation && !deltagere) return fejl('Repræsentation kræver anledning og deltagere — ellers kan fradraget afvises.')

    const kort = kortKode ? kortListe.find(k => k.kode === kortKode) : null
    if (kortKode && !kort) return fejl('Det valgte firmakort findes ikke. Vælg igen.')

    if (!b.bekraeftDublet) {
      const dubletter = await findDubletter(bruger.vendorNo, dato, beloeb)
      if (dubletter.length) return NextResponse.json({ dublet: dubletter }, { status: 409 })
    }

    const session = await getServerSession(authOptions)
    const m = await hentMedarbejder((session?.user as any)?.medarbejder?.id).catch(() => null)
    const email = m?.email ?? ''

    const { id, bilagId } = await opretUdlaeg({
      vendorNo: bruger.vendorNo,
      vendorName: bruger.navn,
      paidWith: kort ? 'Firmakort' : 'Privat',
      cardCode: kort?.kode ?? '',
      bankAccountNo: kort?.bankkonto ?? '',
      accountNo: konto?.kontoNr ?? '',
      purchaseDate: dato,
      merchant: butik.slice(0, 100),
      merchantVatNo: String(b.cvr ?? '').trim().slice(0, 30),
      amountInclVat: Math.round(beloeb * 100) / 100,
      vatAmount: Math.round(moms * 100) / 100,
      currencyCode: valuta === 'DKK' ? '' : valuta,
      purpose: formaal.slice(0, 250),
      participants: deltagere.slice(0, 250),
      submittedBy: email.slice(0, 80),
      pageCount: billeder.length,
    })

    const p = Object.fromEntries(new Intl.DateTimeFormat('da-DK', {
      timeZone: 'Europe/Copenhagen', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date()).map(x => [x.type, x.value]))
    const indsendt = `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`
    const betaltMed = kort ? `Firmakort: ${kort.beskrivelse}` : 'Privat udlæg — skal refunderes til medarbejderen'
    const kontoTekst = konto ? `${konto.kontoNr} ${konto.tekst}` : 'Ved ikke — bogholderiet vælger'

    const pdf = await lavUdlaegPdf({
      bilagId, navn: bruger.navn, vendorNo: bruger.vendorNo, betaltMed,
      bankkonto: kort?.bankkonto ?? '', dato, butik, butikCvr: String(b.cvr ?? '').trim(),
      beloeb, moms, valuta, konto: kontoTekst, formaal, deltagere, indsendt, email,
    }, billeder)

    const beloebTxt = beloeb.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    await sendEmail({
      to: bilagsmail,
      subject: `Udlæg ${bilagId} – ${bruger.navn} – ${butik} – ${beloebTxt} ${valuta}`,
      text:
        `Udlægsbilag ${bilagId} fra medarbejder-appen.\n\n` +
        `Medarbejder: ${bruger.navn} (kreditor ${bruger.vendorNo})\n` +
        `Betalt med: ${betaltMed}\n` +
        `Købsdato: ${dato}\nButik: ${butik}\nBeløb inkl. moms: ${beloebTxt} ${valuta}\n` +
        `Konto: ${kontoTekst}\nFormål: ${formaal}\n` +
        (deltagere ? `Anledning/deltagere: ${deltagere}\n` : ''),
      attachments: [{ filename: `${bilagId}.pdf`, content: pdf, contentType: 'application/pdf' }],
    })
    await markerMailet(id)

    console.log('[bilag/send] OK', bilagId, bruger.vendorNo, beloeb, valuta)
    return NextResponse.json({ ok: true, bilagId })
  } catch (e: any) {
    console.error('[bilag/send]', e?.message)
    return fejl(e?.message || 'Bilaget kunne ikke sendes. Prøv igen.', 502)
  }
}
