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

  try {
    const token = await getAccessToken()
    const base  = bcBaseUrl()

    // BC-URL til billedindhold. VIGTIGT: item.picture er en ENKELT-navigation i standard-API'et,
    // så den må IKKE nøgles med (pictureId) — det giver "Error in query syntax". Korrekt:
    // items(id)/picture/pictureContent. pictureId bruges kun til at vide at varen HAR et billede.
    const url = `${base}/items(${params.itemId})/picture/pictureContent`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      // @ts-ignore — Next.js cache-option
      next: { revalidate: 86400 }, // Cache i 24 timer (billeder ændres sjældent)
    })

    if (!res.ok) return new NextResponse(null, { status: 404 })

    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    const buf = await res.arrayBuffer()

    return new NextResponse(buf, {
      headers: {
        'Content-Type':  contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
