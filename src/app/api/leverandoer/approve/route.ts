import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { getT } from '@/lib/leverandoer/i18n'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin')
    return new NextResponse('Unauthorized', { status: 401 })

  const { id, action } = await req.json() // action: 'approve' | 'reject'
  if (!id || !action) return NextResponse.json({ error: 'id og action er påkrævet' }, { status: 400 })

  const decl = await prisma.supplierDeclaration.findUnique({ where: { id } })
  if (!decl) return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 })

  const status = action === 'approve' ? 'APPROVED' : 'PENDING'
  const updated = await prisma.supplierDeclaration.update({
    where: { id },
    data: {
      status,
      approvedAt: action === 'approve' ? new Date() : null,
      approvedBy: action === 'approve' ? (session.user as any)?.email : null,
    },
  })

  // Send bekræftelsesmail til leverandør
  if (decl.email) {
    const t = getT(decl.lang)
    try {
      await sendEmail({
        to: decl.email,
        subject: action === 'approve'
          ? `${t.title} — Godkendt`
          : `${t.title} — Returneret til revision`,
        text: action === 'approve'
          ? `Jeres leverandørerklæring er gennemgået og godkendt af Venmark Fisk A/S.\n\nNæste fornyelse: ${updated.nextRenewalDate?.toLocaleDateString('da-DK') ?? ''}`
          : `Jeres leverandørerklæring er returneret til revision. Venligst log ind og opdater oplysningerne:\n${process.env.APP_URL}/leverandoer/${decl.token}`,
      })
    } catch {}
  }

  return NextResponse.json({ ok: true })
}
