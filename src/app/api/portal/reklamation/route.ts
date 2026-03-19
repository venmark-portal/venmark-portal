import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendTicketNotification } from '@/lib/email'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const customerId = (session.user as any)?.id as string

  const { subject, body, orderRef, images } = await req.json()
  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Emne og beskrivelse er påkrævet' }, { status: 400 })
  }

  const ticket = await prisma.ticket.create({
    data: {
      customerId,
      type:     'COMPLAINT',
      subject:  subject.trim(),
      body:     body.trim(),
      orderRef: orderRef?.trim() || null,
      images: images?.length
        ? {
            create: images.map((img: { data: string; mimeType: string; fileName: string }) => ({
              data:     img.data,
              mimeType: img.mimeType,
              fileName: img.fileName,
            })),
          }
        : undefined,
    },
  })

  // Send email-notifikation til Venmark (fire-and-forget)
  const customer = await prisma.customer.findUnique({ where: { id: customerId } })
  if (customer) {
    sendTicketNotification({
      ticket:   { id: ticket.id, subject: ticket.subject, body: ticket.body, orderRef: ticket.orderRef },
      customer: { name: customer.name, bcCustomerNumber: customer.bcCustomerNumber, email: customer.email },
    }).catch(err => console.error('Ticket email fejl:', err))
  }

  return NextResponse.json({ id: ticket.id }, { status: 201 })
}
