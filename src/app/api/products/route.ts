import { NextRequest, NextResponse } from 'next/server'
import { getItems } from '@/lib/businesscentral'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const search   = searchParams.get('search')   ?? undefined
  const category = searchParams.get('category') ?? undefined
  const top      = Number(searchParams.get('top')  ?? 50)
  const skip     = Number(searchParams.get('skip') ?? 0)

  try {
    const data = await getItems({ search, category, top, skip })
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ukendt fejl'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
