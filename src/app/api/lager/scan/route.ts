import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { resolveBarcode } from '@/lib/lager/bc'

export const runtime = 'nodejs'

// POST { barcode, locationCode?, context? } → slår stregkoden op i BC.
//
// En kode BC ikke kender er IKKE en fejl: svaret er 200 med found = false, så appen kan
// tilbyde "lær koden". Kun når BC slet ikke kan svare, får appen en 502 — det er forskellen
// mellem "den kode kender vi ikke" og "forbindelsen er væk", og lageret skal kunne se hvad
// af de to der er sket.
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || (token.role !== 'lager' && token.role !== 'admin')) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const barcode = String(body?.barcode ?? '').trim()
  if (!barcode) return NextResponse.json({ error: 'Ingen stregkode' }, { status: 400 })

  const locationCode = String(body?.locationCode ?? (token as any).lagerLocation ?? '').trim()
  const context = String(body?.context ?? 'lager').slice(0, 30)

  const t0 = Date.now()
  // withOnOrder beder BC tælle indgående købsordrer med. Kun optællingens
  // bestillingsforslag har brug for det — pakkeriet skal ikke betale for beregningen
  // ved hvert scan, og derfor er det et valg og ikke altid med.
  const result = await resolveBarcode(barcode, locationCode, context, !!body?.withOnOrder)
  // Opslagstiden er det tal der afgør om scanning føles rigtigt i hånden. Den skal
  // kunne læses i loggen bagefter, ikke gættes på.
  console.log(`[lager scan] ${barcode} → ${result?.itemNo || (result ? 'ukendt' : 'FEJL')} (${Date.now() - t0} ms)`)

  if (!result) {
    return NextResponse.json({ error: 'BC svarede ikke', offline: true }, { status: 502 })
  }
  return NextResponse.json(result)
}
