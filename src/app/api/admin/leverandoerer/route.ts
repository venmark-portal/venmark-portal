import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin')
    return new NextResponse('Unauthorized', { status: 401 })

  const declarations = await prisma.supplierDeclaration.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      documents: { select: { id: true, docType: true, fileName: true, filePath: true } },
      reminders: { orderBy: { sentAt: 'desc' }, take: 1, select: { sentAt: true, type: true } },
    },
  })

  return NextResponse.json(declarations)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin')
    return new NextResponse('Unauthorized', { status: 401 })

  const { id } = await req.json()
  await prisma.supplierDeclaration.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
