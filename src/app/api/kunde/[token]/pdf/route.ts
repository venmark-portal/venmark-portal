import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import path from 'path'
import fs from 'fs'

export const runtime = 'nodejs'

// Serverer den signerede onboarding-PDF. Admin-beskyttet — dokumentet indeholder
// personoplysninger (CPR). Venmark modtager desuden PDF'en som mail-vedhæftning.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin')
    return new NextResponse('Unauthorized', { status: 401 })

  const safe = params.token.replace(/[^a-zA-Z0-9_-]/g, '')
  const file = path.join(process.cwd(), 'uploads', 'onboarding', `${safe}.pdf`)
  if (!fs.existsSync(file)) return new NextResponse('Not found', { status: 404 })

  const buf = fs.readFileSync(file)
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="onboarding-${safe}.pdf"`,
    },
  })
}
