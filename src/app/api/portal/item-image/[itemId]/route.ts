import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }         from 'next-auth'
import { authOptions }              from '@/lib/auth'
import { getAccessToken, bcBaseUrl } from '@/lib/businesscentral'

export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: { itemId: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return new NextResponse('Unauthorized', { status: 401 })

  const pictureId = req.nextUrl.searchParams.get('pictureId')
  if (!pictureId) return new NextResponse('Missing pictureId', { status: 400 })

  let url = ''
  try {
    const token = await getAccessToken()
    const base  = bcBaseUrl()

    // BC-URL til billedindhold
    url = `${base}/items(${params.itemId})/picture(${pictureId})/pictureContent`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      // @ts-ignore — Next.js cache-option
      next: { revalidate: 86400 }, // Cache i 24 timer (billeder ændres sjældent)
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // DIAGNOSE: vis BC-status + URL + fejltekst som ren tekst, så man kan åbne billed-URL'en
      // direkte og se HVORFOR (i stedet for bare et brudt billede). Fjernes når fejlen er fundet.
      return new NextResponse(
        `BILLED-FEJL ${res.status}\nURL: ${url}\n${body.slice(0, 600)}`,
        { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
      )
    }

    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    const buf = await res.arrayBuffer()

    return new NextResponse(buf, {
      headers: {
        'Content-Type':  contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (e) {
    return new NextResponse(
      `BILLED-EXCEPTION: ${e instanceof Error ? e.message : String(e)}\nURL: ${url}`,
      { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }
}
