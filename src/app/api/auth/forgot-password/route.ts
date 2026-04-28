import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendPasswordResetEmail } from '@/lib/email'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const email = body?.email?.trim().toLowerCase()

  if (!email) {
    return NextResponse.json({ error: 'Email mangler' }, { status: 400 })
  }

  // Tjek om email findes — Customer, ContactUser eller AdminUser
  const customer = await prisma.customer.findUnique({ where: { email }, select: { id: true } })
  const admin    = await prisma.adminUser.findUnique({ where: { email }, select: { id: true } })
  const contacts = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "ContactUser" WHERE email = ${email} AND "isActive" = true LIMIT 1
  `
  const exists = !!customer || !!admin || contacts.length > 0

  if (exists) {
    // Slet eksisterende ubrugte tokens for denne email
    await prisma.passwordResetToken.deleteMany({ where: { email, used: false } })

    const token     = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 time

    await prisma.passwordResetToken.create({ data: { email, token, expiresAt } })

    const baseUrl   = process.env.NEXTAUTH_URL ?? 'https://portal.venmark.dk'
    const resetLink = `${baseUrl}/portal/reset-password?token=${token}`

    await sendPasswordResetEmail(email, resetLink)
  }

  // Returner altid success — afslør ikke om email eksisterer
  return NextResponse.json({ ok: true })
}
