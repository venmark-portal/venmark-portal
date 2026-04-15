// GET /api/foto/thumb?entryNo=123  → server første foto for en kasse som image
// Bruges til thumbnail-visning i Specialvarer-sektionen

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readFile } from 'fs/promises'
import path from 'path'

export async function GET(req: NextRequest) {
  const entryNo = Number(req.nextUrl.searchParams.get('entryNo'))
  if (!entryNo) return new NextResponse('Missing entryNo', { status: 400 })

  const foto = await prisma.boxPhoto.findFirst({
    where: { bcBoxEntryNo: entryNo },
    orderBy: { takenAt: 'asc' },
  })
  if (!foto) return new NextResponse('Not found', { status: 404 })

  try {
    const fullPath = path.join(process.cwd(), foto.filePath)
    const data = await readFile(fullPath)
    return new NextResponse(data, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return new NextResponse('File not found', { status: 404 })
  }
}
