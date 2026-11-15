// Medarbejder-logins og deres roller (se src/lib/medarbejder.ts). Ikke at forveksle med
// /api/admin/medarbejdere, som er Dan-Time-kartoteket (initialer på skærmene).
//
//   GET    → medarbejdere + valgmuligheder (chauffører fra BC, lager-brugere)
//   POST   { navn, email }                         → opret
//   PATCH  { id, ...ændringer }                    → roller, aktiv, send kode-link
//
// Kun ubegrænsede admins (ikke skærm-brugere).

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { hash } from 'bcryptjs'
import crypto, { randomUUID } from 'crypto'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isLimitedUser } from '@/lib/signage/screens'
import { ensureLagerSchema } from '@/lib/lager/db'
import { ensureMedarbejderSkema, hentMedarbejder, medarbejderMedEmail, type Medarbejder } from '@/lib/medarbejder'
import { sendPasswordResetEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function erAdmin(): Promise<boolean> {
  const s = await getServerSession(authOptions)
  if ((s?.user as any)?.role !== 'admin') return false
  const id = String((s!.user as any).id ?? '')
  return !!id && !(await isLimitedUser(id).catch(() => true))
}

const nej = () => new NextResponse('Unauthorized', { status: 401 })
const fejl = (tekst: string, status = 400) => NextResponse.json({ fejl: tekst }, { status })

export async function GET() {
  if (!(await erAdmin())) return nej()
  await Promise.all([ensureMedarbejderSkema(), ensureLagerSchema()])
  const [rows, chauffoerer, lager] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT m.*, c."bcCustomerNumber" AS "kundeNr", c.name AS "kundeNavn",
             d.name AS "chauffoerNavn",
             l.name AS "lagerNavn", l.initials AS "lagerInitialer", l."canCount" AS "lagerTaelle", l."canPack" AS "lagerPakke"
      FROM "Medarbejder" m
      LEFT JOIN "Customer"   c ON c.id = m."customerId"
      LEFT JOIN "DriverUser" d ON d.id = m."driverUserId"
      LEFT JOIN "LagerUser"  l ON l.id = m."lagerUserId"
      ORDER BY m.aktiv DESC, m.navn`,
    prisma.$queryRaw<any[]>`SELECT id, name FROM "DriverUser" WHERE "isActive" = true ORDER BY name`,
    prisma.$queryRaw<any[]>`SELECT id, name, initials FROM "LagerUser" WHERE "isActive" = true ORDER BY name`,
  ])
  return NextResponse.json({
    medarbejdere: rows.map(({ passwordHash, ...r }) => ({ ...r, harKode: !!passwordHash })),
    chauffoerer,
    lager,
  })
}

export async function POST(req: NextRequest) {
  if (!(await erAdmin())) return nej()
  await ensureMedarbejderSkema()
  const b = await req.json().catch(() => ({}))
  const navn  = String(b.navn ?? '').trim()
  const email = String(b.email ?? '').trim().toLowerCase()
  if (!navn || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fejl('Skriv navn og en gyldig e-mail.')
  if (await medarbejderMedEmail(email)) return fejl('Der findes allerede en medarbejder med den e-mail.')

  // Har personen allerede et login med samme e-mail (kunde/admin), virker den kode med det samme.
  const kunde = await prisma.customer.findUnique({ where: { email }, select: { passwordHash: true } })
  const admin = await prisma.adminUser.findUnique({ where: { email }, select: { passwordHash: true } })
  const kode  = kunde?.passwordHash ?? admin?.passwordHash ?? null

  const id = randomUUID()
  await prisma.$executeRaw`
    INSERT INTO "Medarbejder" (id, navn, email, "passwordHash") VALUES (${id}, ${navn}, ${email}, ${kode})`
  return NextResponse.json({ ok: true, id, kodeOvertaget: !!kode })
}

export async function PATCH(req: NextRequest) {
  if (!(await erAdmin())) return nej()
  await Promise.all([ensureMedarbejderSkema(), ensureLagerSchema()])
  const b = await req.json().catch(() => ({}))
  const m = await hentMedarbejder(String(b.id ?? ''))
  if (!m) return fejl('Medarbejderen findes ikke.', 404)

  const saet = async (kol: 'adminUserId' | 'lagerUserId' | 'driverUserId' | 'customerId', v: string | null) => {
    // Kolonnenavnet er en af de fire faste værdier i typen — aldrig input.
    await prisma.$executeRawUnsafe(`UPDATE "Medarbejder" SET "${kol}" = $1, "updatedAt" = NOW() WHERE id = $2`, v, m.id)
  }

  if ('navn' in b && String(b.navn).trim()) {
    await prisma.$executeRaw`UPDATE "Medarbejder" SET navn = ${String(b.navn).trim()}, "updatedAt" = NOW() WHERE id = ${m.id}`
  }
  if ('aktiv' in b) {
    await prisma.$executeRaw`UPDATE "Medarbejder" SET aktiv = ${!!b.aktiv}, "updatedAt" = NOW() WHERE id = ${m.id}`
  }

  // Admin: personlig AdminUser-række (samme e-mail). Ingen brugbar egen kode — man kommer ind
  // via medarbejder-login. Findes der allerede en admin med e-mailen, bruges den.
  if ('admin' in b) {
    if (b.admin) {
      let a = await prisma.adminUser.findUnique({ where: { email: m.email } })
      if (!a) {
        a = await prisma.adminUser.create({
          data: { email: m.email, name: m.navn, passwordHash: await hash(crypto.randomBytes(32).toString('hex'), 10) },
        })
      }
      await saet('adminUserId', a.id)
    } else await saet('adminUserId', null)
  }

  // Kunde: medarbejderens egen debitor — skal have en portal-konto (Admin → Kunder).
  if ('kundeNr' in b) {
    const nr = String(b.kundeNr ?? '').trim()
    if (!nr) await saet('customerId', null)
    else {
      const c = await prisma.customer.findFirst({ where: { bcCustomerNumber: nr }, select: { id: true } })
      if (!c) return fejl(`Debitor ${nr} har ingen portal-konto endnu. Opret den under Kunder først.`)
      await saet('customerId', c.id)
    }
  }

  // Chauffør: en af chaufførerne fra BC (PIN sættes i BC som før).
  if ('chauffoerId' in b) {
    const id = String(b.chauffoerId ?? '')
    if (!id) await saet('driverUserId', null)
    else {
      const d = await prisma.$queryRaw<any[]>`SELECT id FROM "DriverUser" WHERE id = ${id} LIMIT 1`
      if (!d[0]) return fejl('Chaufføren findes ikke.')
      await saet('driverUserId', id)
    }
  }

  // Lager/pakker: koble en eksisterende lager-bruger på, eller opret en ny med PIN.
  if ('lager' in b) {
    const l = b.lager as null | { id?: string; ny?: boolean; pin?: string; initialer?: string; taelle?: boolean; pakke?: boolean }
    if (!l) await saet('lagerUserId', null)
    else {
      const pin = String(l.pin ?? '').trim()
      if (pin && !/^\d{4,8}$/.test(pin)) return fejl('PIN skal være 4-8 cifre.')
      let id = l.ny ? '' : String(l.id ?? m.lagerUserId ?? '')
      if (!id) {
        if (!pin) return fejl('En ny lager-bruger skal have en PIN.')
        id = randomUUID()
        await prisma.$executeRaw`
          INSERT INTO "LagerUser" (id, name, initials, "pinHash", "canCount", "canPack")
          VALUES (${id}, ${m.navn}, ${String(l.initialer ?? '').trim() || null}, ${await hash(pin, 10)}, ${l.taelle !== false}, ${!!l.pakke})`
      } else {
        const fandtes = await prisma.$queryRaw<any[]>`SELECT id FROM "LagerUser" WHERE id = ${id} LIMIT 1`
        if (!fandtes[0]) return fejl('Lager-brugeren findes ikke.')
        if ('taelle' in l || 'pakke' in l) {
          await prisma.$executeRaw`
            UPDATE "LagerUser" SET "canCount" = ${l.taelle !== false}, "canPack" = ${!!l.pakke}, "updatedAt" = NOW() WHERE id = ${id}`
        }
        if ('initialer' in l) {
          await prisma.$executeRaw`UPDATE "LagerUser" SET initials = ${String(l.initialer ?? '').trim() || null}, "updatedAt" = NOW() WHERE id = ${id}`
        }
        if (pin) await prisma.$executeRaw`UPDATE "LagerUser" SET "pinHash" = ${await hash(pin, 10)}, "updatedAt" = NOW() WHERE id = ${id}`
      }
      await saet('lagerUserId', id)
    }
  }

  // Send link til at vælge kode (samme mail som "Glemt adgangskode", gyldigt i 24 timer).
  if (b.sendLink) await sendKodeLink(m)

  return NextResponse.json({ ok: true })
}

async function sendKodeLink(m: Medarbejder) {
  await prisma.passwordResetToken.deleteMany({ where: { email: m.email, used: false } })
  const token = crypto.randomBytes(32).toString('hex')
  await prisma.passwordResetToken.create({ data: { email: m.email, token, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } })
  const link = `${process.env.NEXTAUTH_URL ?? 'https://portal.venmark.dk'}/portal/reset-password?token=${token}`
  try { await sendPasswordResetEmail(m.email, link) }
  catch (e: any) { console.error('[medarbejder] kode-link fejlede', m.email, e?.message ?? e) }
}
