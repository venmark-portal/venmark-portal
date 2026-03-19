/**
 * Seed-script — opretter første admin og en test-kunde
 * Kør med: node prisma/seed.js
 */

const { PrismaClient } = require('@prisma/client')
const { hashSync }     = require('bcryptjs')

const prisma = new PrismaClient()

async function main() {
  // ── Admin ───────────────────────────────────────────────
  const adminEmail    = 'admin@venmark.dk'
  const adminPassword = 'VenmarkAdmin2025!'

  const existingAdmin = await prisma.adminUser.findUnique({ where: { email: adminEmail } })
  if (!existingAdmin) {
    await prisma.adminUser.create({
      data: {
        email:        adminEmail,
        passwordHash: hashSync(adminPassword, 12),
        name:         'Admin Venmark',
      },
    })
    console.log('✓ Admin oprettet:', adminEmail, '/', adminPassword)
  } else {
    console.log('ℹ Admin eksisterer:', adminEmail)
  }

  // ── Test-kunde ──────────────────────────────────────────
  const custEmail    = 'test@testkunde.dk'
  const custPassword = 'TestKunde123!'

  const existingCustomer = await prisma.customer.findUnique({ where: { email: custEmail } })
  if (!existingCustomer) {
    await prisma.customer.create({
      data: {
        email:            custEmail,
        passwordHash:     hashSync(custPassword, 12),
        name:             'Test Kunde ApS',
        bcCustomerNumber: 'C00001',
        bcPriceGroup:     'DETAIL',
        isActive:         true,
      },
    })
    console.log('✓ Test-kunde oprettet:', custEmail, '/', custPassword)
  } else {
    console.log('ℹ Test-kunde eksisterer:', custEmail)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
