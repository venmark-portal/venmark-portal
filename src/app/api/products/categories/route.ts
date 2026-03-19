import { NextResponse } from 'next/server'
import { getItemCategories } from '@/lib/businesscentral'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const cats = await getItemCategories()
    return NextResponse.json(cats)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ukendt fejl'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
