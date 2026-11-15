import { NextRequest, NextResponse } from 'next/server'
import { lagerBruger } from '@/lib/lager/auth'
import { bcBaseUrl, getAccessToken } from '@/lib/businesscentral'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Varebilledet, slået op på VARENUMMER (det er det lageret kender; SystemId er et
// internt BC-id som ingen går rundt med i hovedet).
//
// GET  → billedet, eller 404 hvis varen ingen har
// POST → sæt/udskift billedet (multipart med feltet "fil")
//
// Billedet ligger i BC på varen, ikke i portalen. Så ser kontoret, portalen og
// pakkeriet det samme billede — ét sted at vedligeholde, som med etiketterne.

async function itemId(number: string): Promise<string | null> {
  const token = await getAccessToken()
  const filter = encodeURIComponent(`number eq '${number.replace(/'/g, "''")}'`)
  const res = await fetch(`${bcBaseUrl()}/items?$filter=${filter}&$select=id`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  } as any)
  if (!res.ok) {
    console.error(`[lager billede] opslag af ${number} fejlede ${res.status}`)
    return null
  }
  const data = await res.json()
  return data.value?.[0]?.id ?? null
}

export async function GET(req: NextRequest, { params }: { params: { itemNo: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const id = await itemId(decodeURIComponent(params.itemNo))
  if (!id) return new NextResponse(null, { status: 404 })

  const token = await getAccessToken()
  // picture er en ENKELT-navigation: items(id)/picture/pictureContent.
  // Nøgles den med (pictureId), svarer BC "Error in query syntax".
  const res = await fetch(`${bcBaseUrl()}/items(${id})/picture/pictureContent`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  } as any)
  if (!res.ok) return new NextResponse(null, { status: 404 })

  const buf = await res.arrayBuffer()
  return new NextResponse(buf, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
      // Kort cache: billedet kan netop være skiftet fra en terminal.
      'Cache-Control': 'private, max-age=60',
    },
  })
}

export async function POST(req: NextRequest, { params }: { params: { itemNo: string } }) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })

  const form = await req.formData().catch(() => null)
  const fil = form?.get('fil')
  if (!(fil instanceof Blob)) {
    return NextResponse.json({ error: 'Intet billede modtaget' }, { status: 400 })
  }
  if (fil.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'Billedet er for stort (maks 8 MB)' }, { status: 400 })
  }

  const nr = decodeURIComponent(params.itemNo)
  const id = await itemId(nr)
  if (!id) return NextResponse.json({ error: `Vare ${nr} findes ikke` }, { status: 404 })

  const token = await getAccessToken()
  const bytes = Buffer.from(await fil.arrayBuffer())
  const res = await fetch(`${bcBaseUrl()}/items(${id})/picture/pictureContent`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': (fil as any).type || 'image/jpeg',
      // Uden If-Match afviser BC skrivningen. '*' = "uanset hvilken version der ligger".
      'If-Match': '*',
    },
    body: bytes,
    cache: 'no-store',
  } as any)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[lager billede] PATCH ${nr} fejlede ${res.status}: ${body}`)
    return NextResponse.json({ error: `BC afviste billedet (${res.status})` }, { status: 502 })
  }

  console.log(`[lager billede] ${nr} opdateret af ${bruger.navn} (${bytes.length} bytes)`)
  return NextResponse.json({ ok: true })
}
