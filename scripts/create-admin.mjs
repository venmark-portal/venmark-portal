/**
 * Opret admin-bruger og/eller testkunde direkte i databasen.
 * Kør: node scripts/create-admin.mjs
 *
 * Kræver: DATABASE_URL i .env.local (sættes automatisk via dotenv)
 */
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// Indlæs .env.local
const fs  = require('fs')
const path = require('path')
const envFile = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '')
}

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

async function main() {
  // ── Admin-bruger ──────────────────────────────────────────────────────────
  const adminEmail    = 'admin@venmark.dk'
  const adminPassword = 'VenmarkAdmin2025!'

  const existingAdmin = await prisma.adminUser.findUnique({ where: { email: adminEmail } })
  if (existingAdmin) {
    console.log('✓ Admin findes allerede:', existingAdmin.email)
  } else {
    const hash = await bcrypt.hash(adminPassword, 12)
    await prisma.adminUser.create({
      data: { email: adminEmail, passwordHash: hash, name: 'Admin' }
    })
    console.log('✓ Admin oprettet:', adminEmail)
    console.log('  Adgangskode:', adminPassword)
  }

  // ── Testkunde ─────────────────────────────────────────────────────────────
  const customerEmail    = 'test@kunde.dk'
  const customerPassword = 'Test1234!'

  // (Testkunde springes over — opret via admin-panelet på /admin/kunder)

  // ── Vis alle kunder ───────────────────────────────────────────────────────
  console.log('\n── Alle kunder i databasen ──')
  const customers = await prisma.customer.findMany({ select: { email: true, name: true, bcCustomerNumber: true, isActive: true } })
  for (const c of customers) {
    console.log(`  ${c.isActive ? '●' : '○'} ${c.name.padEnd(20)} ${c.email.padEnd(30)} BC: ${c.bcCustomerNumber}`)
  }

  console.log('\n── Admin-brugere ──')
  const admins = await prisma.adminUser.findMany({ select: { email: true, name: true } })
  for (const a of admins) {
    console.log(`  ● ${a.name.padEnd(20)} ${a.email}`)
  }
}

main().catch(e => { console.error('FEJL:', e.message); process.exit(1) }).finally(() => prisma.$disconnect())
