'use server'

import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { saetRobotAktiv, saetRobotInitiativ, ensureRobotSkema, saetKontorVurdering, markerBehandlet } from '@/lib/robot/db'
import { gemVidenPunkt, sletVidenPunkt } from '@/lib/robot/viden'

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

// ── Vurdering og viden ────────────────────────────────────────────────────────

async function adminNavn(): Promise<string> {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'admin') throw new Error('Kun admin')
  return String(session?.user?.name ?? session?.user?.email ?? 'admin')
}

/** Kontorets 👍/👎 på et svar (markerer det samtidig som gennemgået). */
export async function vurderSvar(form: FormData) {
  await kraevAdmin()
  const v = Number(form.get('v'))
  await saetKontorVurdering(Number(form.get('id')), v === 1 ? 1 : v === -1 ? -1 : null, String(form.get('note') ?? '').trim() || null)
  revalidatePath('/admin/robot')
}

export async function markerSvarBehandlet(form: FormData) {
  await kraevAdmin()
  await markerBehandlet(Number(form.get('id')))
  revalidatePath('/admin/robot')
}

export async function gemViden(form: FormData) {
  const af = await adminNavn()
  const emne = String(form.get('emne') ?? '').trim()
  const tekst = String(form.get('tekst') ?? '').trim()
  if (!emne || !tekst) return
  const id = Number(form.get('id') ?? 0) || undefined
  const beskedId = Number(form.get('beskedId') ?? 0) || null
  // Redigér-formularen har et "Aktiv"-flueben (harAktiv=1); en ny viden er altid aktiv.
  const aktiv = form.get('harAktiv') === '1' ? form.get('aktiv') === '1' : true
  await gemVidenPunkt({ id, emne, tekst, aktiv, kilde: beskedId ? 'samtale' : 'manuel', beskedId, af })
  if (beskedId) await markerBehandlet(beskedId)
  revalidatePath('/admin/robot')
  revalidatePath('/admin/robot/viden')
  if (beskedId) redirect('/admin/robot/viden')
}

export async function sletViden(form: FormData) {
  await kraevAdmin()
  await sletVidenPunkt(Number(form.get('id')))
  revalidatePath('/admin/robot/viden')
}
