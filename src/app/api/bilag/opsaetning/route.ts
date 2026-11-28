import { NextResponse } from 'next/server'
import { udlaegBrugerFraSession, hentKonti, hentFirmakort, hentBilagsmail } from '@/lib/udlaeg'
import { aflaesningKonfigureret } from '@/lib/udlaegAflaes'

export const dynamic = 'force-dynamic'

// ?kort=1 → kun adgangstjek (bruges af menuen), ellers alt formularen skal bruge.
export async function GET(req: Request) {
  try {
    const bruger = await udlaegBrugerFraSession()
    if (!bruger) return NextResponse.json({ tilladt: false })
    if (new URL(req.url).searchParams.get('kort')) return NextResponse.json({ tilladt: true })
    const [konti, kort, bilagsmail] = await Promise.all([hentKonti(), hentFirmakort(bruger.vendorNo), hentBilagsmail()])
    return NextResponse.json({
      tilladt: true,
      bruger: { navn: bruger.navn, vendorNo: bruger.vendorNo },
      konti, kort,
      klar: Boolean(bilagsmail),
      aflaesning: aflaesningKonfigureret(),
    })
  } catch (e: any) {
    console.error('[bilag/opsaetning]', e?.message)
    return NextResponse.json({ tilladt: false, fejl: 'BC svarer ikke lige nu. Prøv igen om lidt.' }, { status: 502 })
  }
}
