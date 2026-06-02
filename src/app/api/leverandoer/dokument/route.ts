import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readFile } from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin')
    return new NextResponse('Unauthorized', { status: 401 })

  const filePath = req.nextUrl.searchParams.get('path')
  if (!filePath) return new NextResponse('Mangler path', { status: 400 })

  // Sikkerhedstjek — kun uploads/leverandoer/ er tilladt
  const normalized = path.normalize(filePath).replace(/\\/g, '/')
  if (!normalized.startsWith('uploads/leverandoer/'))
    return new NextResponse('Forbudt', { status: 403 })

  try {
    const fullPath = path.join(process.cwd(), normalized)
    const data = await readFile(fullPath)
    const ext = path.extname(normalized).toLowerCase()
    const mime =
      ext === '.pdf' ? 'application/pdf' :
      ext === '.png' ? 'image/png' :
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream'

    return new NextResponse(data, {
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `inline; filename="${path.basename(normalized)}"`,
      },
    })
  } catch {
    return new NextResponse('Fil ikke fundet', { status: 404 })
  }
}
