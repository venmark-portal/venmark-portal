import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import path from 'path'
import fs from 'fs'
import { sendEmail } from '@/lib/email'

export const runtime = 'nodejs'

// GET — hent erklæring + stamdata via token
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const decl = await prisma.supplierDeclaration.findUnique({
    where: { token: params.token },
    include: { documents: true },
  })
  if (!decl) return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 })
  return NextResponse.json(decl)
}

// POST — indsend udfyldt erklæring (multipart/form-data)
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const decl = await prisma.supplierDeclaration.findUnique({ where: { token: params.token } })
  if (!decl) return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 })
  if (decl.status === 'APPROVED') return NextResponse.json({ error: 'Allerede godkendt' }, { status: 400 })

  const form = await req.formData()

  const data: Record<string, any> = {
    lang:              form.get('lang')            as string || decl.lang,
    companyName:       form.get('companyName')     as string || null,
    vatNo:             form.get('vatNo')           as string || null,
    address:           form.get('address')         as string || null,
    country:           form.get('country')         as string || null,
    phone:             form.get('phone')           as string || null,
    email:             form.get('email')           as string || null,
    contactPerson:     form.get('contactPerson')   as string || null,
    qualityManager:    form.get('qualityManager')  as string || null,
    emergencyPhone:    form.get('emergencyPhone')  as string || null,
    hasThirdPartyCert: form.get('hasThirdPartyCert') === 'true',
    certTypes:         form.get('certTypes')       as string || null,
    certNumber:        form.get('certNumber')      as string || null,
    certExpiry:        form.get('certExpiry')      ? new Date(form.get('certExpiry') as string) : null,
    hasMsc:            form.get('hasMsc')          === 'true',
    mscCertNumber:     form.get('mscCertNumber')   as string || null,
    mscExpiry:         form.get('mscExpiry')       ? new Date(form.get('mscExpiry') as string) : null,
    haccpAnswers:      form.get('haccpAnswers')    as string || null,
    selfControlAnswers:form.get('selfControlAnswers') as string || null,
    signerName:        form.get('signerName')      as string || null,
    signerTitle:       form.get('signerTitle')     as string || null,
    signerEmail:       form.get('signerEmail')     as string || null,
    confirmedAt:       new Date(),
    ipAddress:         req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
    status:            'SUBMITTED',
    submittedAt:       new Date(),
    nextRenewalDate:   new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  }

  // Gem uploadede dokumenter
  const uploadDir = path.join(process.cwd(), 'uploads', 'leverandoer', decl.bcVendorNo)
  fs.mkdirSync(uploadDir, { recursive: true })

  const docEntries: { docType: string; file: File }[] = []
  for (const [key, value] of form.entries()) {
    if (key.startsWith('doc_') && value instanceof File && value.size > 0) {
      docEntries.push({ docType: key.replace('doc_', ''), file: value as File })
    }
  }

  const savedDocs = await Promise.all(docEntries.map(async ({ docType, file }) => {
    const ext = file.name.split('.').pop() ?? 'bin'
    const id = Math.random().toString(36).slice(2)
    const fileName = `${id}.${ext}`
    const filePath = `uploads/leverandoer/${decl.bcVendorNo}/${fileName}`
    const buf = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(path.join(process.cwd(), filePath), buf)
    return { docType, fileName: file.name, filePath, mimeType: file.type, fileSize: file.size }
  }))

  const updated = await prisma.supplierDeclaration.update({
    where: { token: params.token },
    data,
  })

  if (savedDocs.length > 0) {
    await prisma.supplierDocument.createMany({
      data: savedDocs.map(d => ({ ...d, declarationId: updated.id })),
    })
  }

  // Notificer admin
  try {
    const settings = await prisma.portalSettings.findUnique({ where: { id: 'default' } })
    const adminEmail = settings?.kvalitetschefEmail || process.env.NOTIFICATION_EMAIL
    if (adminEmail) {
      await sendEmail({
        to: adminEmail,
        subject: `Leverandørerklæring modtaget — ${data.companyName || decl.bcVendorNo}`,
        text: `Leverandørerklæring er indsendt af ${data.companyName || decl.bcVendorNo} (${decl.bcVendorNo}).\n\nUnderskrevet af: ${data.signerName} (${data.signerTitle})\nEmail: ${data.signerEmail}\n\nGodkend på: ${process.env.APP_URL}/admin/leverandoerer`,
      })
    }
  } catch {}

  // Opdater BC vendor status → Afventer (1)
  try {
    await updateBCVendorStatus(decl.bcVendorNo, 'Afventer', updated.nextRenewalDate)
  } catch (e) {
    console.error('BC vendor status webhook fejlede:', e)
  }

  return NextResponse.json({ ok: true })
}

async function updateBCVendorStatus(vendorNo: string, status: string, nextRenewal: Date | null) {
  const { getAccessToken, bcPortalBaseUrl } = await import('@/lib/businesscentral')
  const token = await getAccessToken()
  const base  = bcPortalBaseUrl()

  // Find vendor via API
  const searchRes = await fetch(
    `${base}/vendorDeclarationStatuses?$filter=vendorNo eq '${vendorNo}'`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
  )
  if (!searchRes.ok) return

  const data = await searchRes.json()
  const vendor = data.value?.[0]
  if (!vendor) return

  const statusMap: Record<string, number> = { 'Ikke Modtaget': 0, 'Afventer': 1, 'Godkendt': 2, 'Udlobet': 3 }

  await fetch(
    `${base}/vendorDeclarationStatuses('${vendorNo}')`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'If-Match': '*',
      },
      body: JSON.stringify({
        erklaeringStatus: statusMap[status] ?? 1,
        erlaeringSidstModtaget: new Date().toISOString().split('T')[0],
        naestFornyelsesdato: nextRenewal ? nextRenewal.toISOString().split('T')[0] : null,
      }),
    }
  )
}
