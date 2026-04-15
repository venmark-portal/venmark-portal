// POST /api/foto/upload
// Body: multipart/form-data med felt "foto" (JPEG/PNG) + "bcBoxEntryNo" + "pendingId"
// Gemmer filen på disk og opretter BoxPhoto-record

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const foto = form.get('foto') as File | null
  const bcBoxEntryNo = Number(form.get('bcBoxEntryNo'))
  const pendingId = form.get('pendingId') as string | null
  const boxWeight = form.get('boxWeight') ? Number(form.get('boxWeight')) : undefined
  const itemNo = form.get('itemNo') as string | undefined

  if (!foto || !bcBoxEntryNo) {
    return NextResponse.json({ error: 'foto og bcBoxEntryNo kræves' }, { status: 400 })
  }

  // Mappe: uploads/boxfotos/YYYY-MM/
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const uploadDir = path.join(process.cwd(), 'uploads', 'boxfotos', ym)
  await mkdir(uploadDir, { recursive: true })

  const ext = foto.type === 'image/png' ? 'png' : 'jpg'
  const filename = `${Date.now()}-${bcBoxEntryNo}.${ext}`
  const filePath = `uploads/boxfotos/${ym}/${filename}`
  const absPath = path.join(process.cwd(), filePath)

  const bytes = await foto.arrayBuffer()
  await writeFile(absPath, Buffer.from(bytes))

  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const record = await prisma.boxPhoto.create({
    data: {
      bcBoxEntryNo,
      filePath,
      expiresAt,
      boxWeight: boxWeight ?? null,
      itemNo: itemNo ?? null,
    },
  })

  // Marker pending som captured
  if (pendingId) {
    await prisma.pendingCapture.update({
      where: { id: pendingId },
      data: { captured: true },
    }).catch(() => {})
  }

  return NextResponse.json({ id: record.id, filePath })
}
