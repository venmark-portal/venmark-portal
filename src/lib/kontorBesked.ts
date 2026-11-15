// En besked til kontoret i kundens navn — samme vej som når kunden skriver under Beskeder
// (api/portal/messages): Message-tabellen + BC (kontorskærmen) + ulæst-flaget på debitoren.

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { pushBeskedTilBC, flagBeskedUlaest } from '@/lib/businesscentral'

export async function sendKontorBesked(k: { customerId: string; customerNo: string; navn: string }, body: string): Promise<void> {
  const id = randomUUID()
  const udloeb = new Date(); udloeb.setDate(udloeb.getDate() + 30)
  await prisma.$executeRaw`
    INSERT INTO "Message" (id, "customerId", sender, "senderName", body, "readByAdmin", "readByCustomer", "createdAt", "expiresAt")
    VALUES (${id}, ${k.customerId}, 'customer', ${k.navn}, ${body}, false, true, NOW(), ${udloeb})
  `
  const nu = new Date()
  const tz = 'Europe/Copenhagen'
  pushBeskedTilBC(k.customerNo, {
    id, sender: 'customer', senderName: k.navn, body,
    createdAtDK: nu.toLocaleTimeString('da-DK', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) + ' ' +
                 nu.toLocaleDateString('da-DK', { timeZone: tz, day: '2-digit', month: '2-digit' }),
  }).catch(err => console.error('[kontor-besked] til BC fejlede', err))
  flagBeskedUlaest(k.customerNo).catch(() => {})
}
