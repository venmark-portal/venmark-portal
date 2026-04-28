import { NextResponse } from 'next/server'
import { hash } from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const { token, password } = body ?? {}

  if (!token || !password) {
    return NextResponse.json({ error: 'Manglende data' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Adgangskoden skal være mindst 8 tegn' }, { status: 400 })
  }

  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } })

  if (!resetToken || resetToken.used || resetToken.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Linket er ugyldigt eller udløbet' }, { status: 400 })
  }

  const email        = resetToken.email
  const passwordHash = await hash(password, 12)

  // Opdater adgangskode i den rigtige tabel
  const customer = await prisma.customer.findUnique({ where: { email }, select: { id: true } })
  if (customer) {
    await prisma.customer.update({ where: { email }, data: { passwordHash } })
  } else {
    const admin = await prisma.adminUser.findUnique({ where: { email }, select: { id: true } })
    if (admin) {
      await prisma.adminUser.update({ where: { email }, data: { passwordHash } })
    } else {
      // ContactUser — bruger raw SQL da model måske ikke er i generated client
      await prisma.$executeRaw`UPDATE "ContactUser" SET "passwordHash" = ${passwordHash} WHERE email = ${email}`
    }
  }

  // Markér token som brugt
  await prisma.passwordResetToken.update({ where: { token }, data: { used: true } })

  return NextResponse.json({ ok: true })
}
