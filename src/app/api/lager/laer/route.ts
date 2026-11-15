import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { learnBarcode } from '@/lib/lager/bc'
import { gemIdempotentSvar, hentIdempotentSvar } from '@/lib/lager/db'

export const runtime = 'nodejs'

// POST { barcode, itemNo, unitOfMeasureCode?, idempotencyKey? }
// Knytter en ukendt stregkode til en vare. Koden bliver en ÆGTE varereference i BC, så
// den virker overalt bagefter — også i pakkeriet og på salg. Det er den funktion der
// gør at dækningen bliver bedre for hver optælling i stedet for at stå stille.
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || (token.role !== 'lager' && token.role !== 'admin')) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const barcode = String(body?.barcode ?? '').trim()
  const itemNo = String(body?.itemNo ?? '').trim().toUpperCase()
  const uom = String(body?.unitOfMeasureCode ?? '').trim().toUpperCase()
  const key = String(body?.idempotencyKey ?? '').trim()
  if (!barcode || !itemNo) {
    return NextResponse.json({ error: 'barcode og itemNo skal udfyldes' }, { status: 400 })
  }

  const tidligere = await hentIdempotentSvar(key)
  if (tidligere) return NextResponse.json(tidligere)

  const result = await learnBarcode(barcode, itemNo, uom, 'lager')
  if (!result) {
    return NextResponse.json({ error: 'BC svarede ikke', offline: true }, { status: 502 })
  }

  console.log(
    `[lager laer] ${barcode} → ${itemNo} ${result.created ? 'oprettet' : 'AFVIST: ' + result.errorText}`,
  )
  // Kun et faktisk oprettet svar gemmes. En afvisning skal kunne prøves igen med en
  // anden vare uden at nøglen står i vejen.
  if (result.created) {
    await gemIdempotentSvar(key, 'laer', (token.sub as string) ?? null, result)
  }
  return NextResponse.json(result)
}
