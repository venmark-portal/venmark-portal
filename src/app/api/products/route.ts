import { NextRequest, NextResponse } from 'next/server'
import { getItems, getWebshopVisibleItemNos } from '@/lib/businesscentral'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const search   = searchParams.get('search')   ?? undefined
  const category = searchParams.get('category') ?? undefined
  const top      = Number(searchParams.get('top')  ?? 50)
  const skip     = Number(searchParams.get('skip') ?? 0)

  try {
    // Søgning skal også respektere portal-synligheden (RangeringPrisliste = 99 = skjult).
    const [data, visible] = await Promise.all([
      getItems({ search, category, top, skip }),
      getWebshopVisibleItemNos().catch(() => null),
    ])
    if (visible && data && Array.isArray((data as any).value))
      (data as any).value = (data as any).value.filter((i: any) => visible.has(i.number))
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ukendt fejl'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
