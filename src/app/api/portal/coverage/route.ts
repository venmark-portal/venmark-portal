import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getActiveCustomerNo } from '@/lib/activeCustomer'
import { getCustomerLocationCode, getCartCoverage, type BCCoverageRow } from '@/lib/businesscentral'

// Giv BC-genberegningen tid (mange producerede varer = tung live-BOM). Uden dette kan et
// serverless-timeout (10s) afbryde kaldet → tomt coverage → portalen falder tilbage til dagens tal.
export const maxDuration = 120

// Autoritativ disponibel-genberegning: portalen kalder denne når kunden skifter leveringsdato eller
// -form. BC returnerer maks pr. vare (samme logik som salgslinjen). Varenumre chunkes så BC's
// "Item Nos"-felt (2048 tegn) ikke overskrides.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ results: [] }, { status: 401 })
  try {
    const body = await req.json()
    const itemNos: string[] = Array.isArray(body?.itemNos)
      ? body.itemNos.filter((n: unknown): n is string => typeof n === 'string' && !!n)
      : []
    const deliveryDate: string       = typeof body?.deliveryDate === 'string' ? body.deliveryDate : ''
    const shipmentMethodCode: string = typeof body?.shipmentMethodCode === 'string' ? body.shipmentMethodCode : ''
    // Kurven (varenr → antal). KUN denne kundes egen visning: BC netter den ind pr. vare (undtagen
    // varen selv), så søsken med samme stykliste falder. Reserverer intet, deles ikke.
    const cart: Record<string, number> = {}
    if (body?.cart && typeof body.cart === 'object')
      for (const [k, v] of Object.entries(body.cart as Record<string, unknown>))
        if (typeof v === 'number' && v > 0) cart[k] = v

    if (!itemNos.length || !deliveryDate) return NextResponse.json({ results: [] })

    const customerNo = getActiveCustomerNo(session)
    if (!customerNo) return NextResponse.json({ results: [] })
    const loc = await getCustomerLocationCode(customerNo).catch(() => '')

    // Chunk SMÅT (25) så BC's resultJson holder sig under tekstfeltets 2048 tegn. Kør parallelt
    // for at holde svartiden nede trods flere kald (tung live-BOM pr. producerede vare).
    const chunks: string[][] = []
    for (let i = 0; i < itemNos.length; i += 25) chunks.push(itemNos.slice(i, i + 25))

    const results: BCCoverageRow[] = []
    const diag: string[] = []
    let effectiveDate = ''
    const settled = await Promise.all(chunks.map(async (chunk) => {
      try {
        const cov = await getCartCoverage(customerNo, loc, deliveryDate, shipmentMethodCode, chunk, cart)
        if (cov) return { cov }
        return { err: `chunk(${chunk.length}) → null (intet svar)` }
      } catch (e: unknown) {
        return { err: `chunk(${chunk.length}) → FEJL: ${e instanceof Error ? e.message : String(e)}` }
      }
    }))
    for (const s of settled) {
      if (s.cov) { results.push(...s.cov.results); effectiveDate = s.cov.effectiveDate }
      else if (s.err) diag.push(s.err)
    }
    return NextResponse.json({ effectiveDate, results, diag })
  } catch (e: unknown) {
    return NextResponse.json({ results: [], diag: [`route-fejl: ${e instanceof Error ? e.message : String(e)}`] }, { status: 500 })
  }
}
