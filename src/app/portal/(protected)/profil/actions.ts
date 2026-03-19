'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { compare, hash } from 'bcryptjs'
import { revalidatePath } from 'next/cache'

async function getCustomerId(): Promise<string> {
  const session = await getServerSession(authOptions)
  const id = (session?.user as any)?.id as string | undefined
  if (!id) throw new Error('Ikke logget ind')
  return id
}

// ─── Favoritter ───────────────────────────────────────────────────────────────

export async function addFavorite(bcItemNumber: string, itemName: string): Promise<void> {
  const customerId = await getCustomerId()
  await prisma.favorite.upsert({
    where:  { customerId_bcItemNumber: { customerId, bcItemNumber } },
    update: { itemName },
    create: { customerId, bcItemNumber, itemName },
  })
  revalidatePath('/portal/profil')
  revalidatePath('/portal/bestil')
}

export async function removeFavorite(bcItemNumber: string): Promise<void> {
  const customerId = await getCustomerId()
  await prisma.favorite.deleteMany({ where: { customerId, bcItemNumber } })
  revalidatePath('/portal/profil')
  revalidatePath('/portal/bestil')
}

// ─── Skjulte varer ────────────────────────────────────────────────────────────

export async function addBlockedItem(bcItemNumber: string, itemName: string): Promise<void> {
  const customerId = await getCustomerId()
  // Fjern fra favoritter hvis den er der
  await prisma.favorite.deleteMany({ where: { customerId, bcItemNumber } })
  await prisma.blockedItem.upsert({
    where:  { customerId_bcItemNumber: { customerId, bcItemNumber } },
    update: {},
    create: { customerId, bcItemNumber },
  })
  revalidatePath('/portal/profil')
  revalidatePath('/portal/bestil')
}

export async function removeBlockedItem(bcItemNumber: string): Promise<void> {
  const customerId = await getCustomerId()
  await prisma.blockedItem.deleteMany({ where: { customerId, bcItemNumber } })
  revalidatePath('/portal/profil')
  revalidatePath('/portal/bestil')
}

// ─── Adgangskode ─────────────────────────────────────────────────────────────

export async function changePassword(
  currentPassword: string,
  newPassword:     string,
): Promise<void> {
  const customerId = await getCustomerId()
  const customer   = await prisma.customer.findUnique({ where: { id: customerId } })
  if (!customer) throw new Error('Kunde ikke fundet')

  const valid = await compare(currentPassword, customer.passwordHash)
  if (!valid) throw new Error('Nuværende adgangskode er forkert')

  if (newPassword.length < 8) throw new Error('Ny adgangskode skal være mindst 8 tegn')
  if (newPassword === currentPassword) throw new Error('Ny adgangskode må ikke være den samme')

  const passwordHash = await hash(newPassword, 12)
  await prisma.customer.update({ where: { id: customerId }, data: { passwordHash } })
}
