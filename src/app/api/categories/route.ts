import { NextResponse } from 'next/server'
import { getItemCategories } from '@/lib/businesscentral'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const categories = await getItemCategories()
    return NextResponse.json(categories)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ukendt fejl'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
