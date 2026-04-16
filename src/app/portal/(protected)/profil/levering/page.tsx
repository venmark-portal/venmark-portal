import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import DeliveryProfileForm from './DeliveryProfileForm'

export const dynamic = 'force-dynamic'

export default async function LeveringPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')
  const customerId   = (session.user as any).id
  const bcCustomerNo = (session.user as any).bcCustomerNumber ?? ''

  const profiles = await prisma.$queryRaw<any[]>`
    SELECT * FROM "DeliveryProfile" WHERE "customerId" = ${customerId} LIMIT 1
  `
  const profileRow = profiles[0] ?? null
  let profile: any = null
  if (profileRow) {
    const photos = await prisma.$queryRaw<any[]>`
      SELECT * FROM "DeliveryPhoto" WHERE "profileId" = ${profileRow.id} ORDER BY "sortOrder" ASC
    `
    profile = { ...profileRow, photos }
  }

  // POD-modtagere
  let podRecipients: any[] = []
  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "PodRecipient" (
        id             TEXT PRIMARY KEY,
        "bcCustomerNo" TEXT NOT NULL,
        name           TEXT,
        email          TEXT,
        phone          TEXT,
        "sendEmail"    BOOLEAN NOT NULL DEFAULT false,
        "sendSms"      BOOLEAN NOT NULL DEFAULT false,
        "sortOrder"    INTEGER NOT NULL DEFAULT 0
      )
    `
    podRecipients = await prisma.$queryRaw<any[]>`
      SELECT id, name, email, phone, "sendEmail", "sendSms"
      FROM "PodRecipient" WHERE "bcCustomerNo" = ${bcCustomerNo} ORDER BY "sortOrder"
    `
  } catch {}

  return (
    <div className="space-y-4">
      <div>
        <a href="/portal/profil" className="text-sm text-blue-600 hover:underline">← Tilbage til profil</a>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Leveringsoplysninger</h1>
        <p className="mt-1 text-sm text-gray-500">
          Adgangskoder og instruktioner til chauffører. Gemmes sikkert og vises kun til vores chauffører.
        </p>
      </div>
      <DeliveryProfileForm initialProfile={profile as any} initialPodRecipients={podRecipients} />
    </div>
  )
}
