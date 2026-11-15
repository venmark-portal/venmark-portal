'use server'

import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { saetRobotAktiv, saetRobotInitiativ, ensureRobotSkema } from '@/lib/robot/db'

async function kraevAdmin() {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'admin') throw new Error('Kun admin')
}

/** Tilføj kunde ud fra BC-kundenummer (eller portal-id). */
export async function tilfoejRobotKunde(form: FormData) {
  await kraevAdmin()
  const nr = String(form.get('kundenr') ?? '').trim().split(' ')[0]
  if (!nr) return
  const c = await prisma.customer.findFirst({ where: { OR: [{ bcCustomerNumber: nr }, { id: nr }] }, select: { id: true } })
  if (!c) return
  await saetRobotAktiv(c.id, true)
  revalidatePath('/admin/robot')
}

export async function skiftRobotAktiv(form: FormData) {
  await kraevAdmin()
  await saetRobotAktiv(String(form.get('id')), form.get('aktiv') === '1')
  revalidatePath('/admin/robot')
}

export async function skiftRobotInitiativ(form: FormData) {
  await kraevAdmin()
  await saetRobotInitiativ(String(form.get('id')), form.get('initiativ') === '1')
  revalidatePath('/admin/robot')
}

export async function fjernRobotKunde(form: FormData) {
  await kraevAdmin()
  await ensureRobotSkema()
  const id = String(form.get('id'))
  await prisma.$executeRaw`DELETE FROM "RobotKunde" WHERE "customerId" = ${id}`
  revalidatePath('/admin/robot')
}
