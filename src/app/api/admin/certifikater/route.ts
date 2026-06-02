import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin')
    return new NextResponse('Unauthorized', { status: 401 })

  const certs = await prisma.vendorCertificate.findMany({
    orderBy: [{ bcVendorNo: 'asc' }, { certType: 'asc' }],
  })

  // Hent leverandørnavne fra erklæringer
  const decls = await prisma.supplierDeclaration.findMany({
    select: { bcVendorNo: true, companyName: true },
    distinct: ['bcVendorNo'],
  })
  const nameMap = Object.fromEntries(decls.map(d => [d.bcVendorNo, d.companyName]))

  return NextResponse.json(certs.map(c => ({ ...c, companyName: nameMap[c.bcVendorNo] ?? null })))
}

// PATCH — admin kan manuelt opdatere et certifikat
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin')
    return new NextResponse('Unauthorized', { status: 401 })

  const { bcVendorNo, certType, certNumber, certExpiry } = await req.json()

  const cert = await prisma.vendorCertificate.upsert({
    where: { bcVendorNo_certType: { bcVendorNo, certType } },
    update: { certNumber: certNumber || null, certExpiry: certExpiry ? new Date(certExpiry) : null },
    create: { bcVendorNo, certType, certNumber: certNumber || null, certExpiry: certExpiry ? new Date(certExpiry) : null },
  })

  return NextResponse.json(cert)
}
