// POST /api/foto/cleanup  (kald med secret header fra cron)
// Sletter BoxPhoto-records + filer der er udløbet (expiresAt < nu)
// Konfigurer PM2/cron: curl -X POST https://venmark.dk/api/foto/cleanup -H "x-cron-secret: ..."

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { unlink } from 'fs/promises'
import path from 'path'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const expired = await prisma.boxPhoto.findMany({
    where: { expiresAt: { lt: new Date() } },
  })

  let deleted = 0
  let fileErrors = 0

  for (const photo of expired) {
    try {
      await unlink(path.join(process.cwd(), photo.filePath))
    } catch {
      fileErrors++
    }
    await prisma.boxPhoto.delete({ where: { id: photo.id } })
    deleted++
  }

  // Ryd også gamle PendingCapture-records
  await prisma.pendingCapture.deleteMany({
    where: { requestedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  })

  return NextResponse.json({ deleted, fileErrors })
}
