/**
 * Seed-script — opretter første admin-bruger og en test-kunde
 * Kør med: npx ts-node prisma/seed.ts
 * ELLER:   node -e "require('./prisma/seed.js')"
 *
 * Ændr email + kodeord nedenfor inden du kører det!
 */

import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // ── Admin ─────────────────────────────────────────────────────────────────
  const adminEmail    = 'admin@venmark.dk'
  const adminPassword = 'VenmarkAdmin2025!'   // ← SKIFT DETTE

  const existingAdmin = await prisma.adminUser.findUnique({ where: { email: adminEmail } })
  if (!existingAdmin) {
    await prisma.adminUser.create({
      data: {
        email:        adminEmail,
        passwordHash: await hash(adminPassword, 12),
        name:         'Admin Venmark',
      },
    })
    console.log(`✓ Admin oprettet: ${adminEmail}`)
  } else {
    console.log(`ℹ Admin eksisterer allerede: ${adminEmail}`)
  }

  // ── Test-kunde ────────────────────────────────────────────────────────────
  const customerEmail    = 'testkundeDE@test.dk'
  const customerPassword = 'TestKunde123!'     // ← SKIFT DETTE

  const existingCustomer = await prisma.customer.findUnique({ where: { email: customerEmail } })
  if (!existingCustomer) {
    await prisma.customer.create({
      data: {
        email:            customerEmail,
        passwordHash:     await hash(customerPassword, 12),
        name:             'Test Kunde ApS',
        bcCustomerNumber: 'C00001',
        bcPriceGroup:     'DETAIL',
        isActive:         true,
      },
    })
    console.log(`✓ Test-kunde oprettet: ${customerEmail}`)
  } else {
    console.log(`ℹ Test-kunde eksisterer allerede: ${customerEmail}`)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
