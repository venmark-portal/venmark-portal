/**
 * POST /api/bc/sync-customer
 *
 * Webhook kaldt fra BC (debitorkortet) når en kunde skal oprettes/opdateres i portalen.
 * Sæt BC_WEBHOOK_SECRET i .env.local
 *
 * Body (JSON):
 * {
 *   "customerNo": "C001",          // BC debitornummer (påkrævet)
 *   "name": "Firma ApS",
 *   "email": "kunde@firma.dk",     // login-email (påkrævet)
 *   "phone": "12345678",
 *   "address": "Havnegade 1",
 *   "city": "Hirtshals",
 *   "zipCode": "9850",
 *   "priceGroup": "FISK01",
 *   "debitorGroup": "Standard",
 *   "requirePoNumber": false,
 *   "portalAktiv": true,           // BC "Portal Aktiv" — styrer om kunden kan logge ind
 *   "blocked": false,              // BC "Blocked" felt — blokerer login uanset portalAktiv
 *   "contacts": [                  // Ansatte der kan bestille for kunden
 *     { "name": "Ole Hansen", "email": "ole@firma.dk" }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { randomBytes } from 'crypto'
import { hash } from 'bcryptjs'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // ── Autentificering ──────────────────────────────────────────────────────
  const secret = req.headers.get('x-webhook-secret')
  if (!secret || secret !== process.env.BC_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Uautoriseret' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 })
  }

  const {
    customerNo,
    name,
    email,
    phone,
    address,
    city,
    zipCode,
    priceGroup,
    debitorGroup,
    requirePoNumber = false,
    portalAktiv = true,
    blocked = false,
    contacts = [],
  } = body

  if (!customerNo || !email) {
    return NextResponse.json({ error: 'customerNo og email er påkrævet' }, { status: 400 })
  }

  const emailLower = email.toLowerCase().trim()

  try {
    // ── Find eksisterende kunde ──────────────────────────────────────────────
    const existing = await prisma.customer.findFirst({
      where: {
        OR: [
          { bcCustomerNumber: customerNo },
          { email: emailLower },
        ],
      },
    })

    let customerId: string
    let tempPassword: string | null = null
    let action: string

    if (existing) {
      // Opdater eksisterende — brug $executeRaw for nye felter (prisma generate DLL-lock workaround)
      await prisma.$executeRaw`
        UPDATE Customer
        SET name                 = ${name ?? existing.name},
            email                = ${emailLower},
            phone                = ${phone ?? null},
            address              = ${address ?? null},
            city                 = ${city ?? null},
            zipCode              = ${zipCode ?? null},
            bcPriceGroup         = ${priceGroup ?? existing.bcPriceGroup},
            bcDebitorBookingGroup = ${debitorGroup ?? (existing as any).bcDebitorBookingGroup},
            requirePoNumber      = ${requirePoNumber ? 1 : 0},
            isActive             = ${portalAktiv ? 1 : 0},
            bcBlocked            = ${blocked ? 1 : 0},
            updatedAt            = ${new Date().toISOString()}
        WHERE id = ${existing.id}
      `
      customerId = existing.id
      action = 'updated'
    } else {
      // Opret ny kunde med auto-genereret midlertidigt password
      tempPassword = randomBytes(6).toString('base64url') // ~8 tegn, brugervenligt
      const passwordHash = await hash(tempPassword, 10)

      // Brug prisma.customer.create for de kendte felter
      const newCustomer = await prisma.customer.create({
        data: {
          bcCustomerNumber:      customerNo,
          name:                  name ?? customerNo,
          email:                 emailLower,
          bcPriceGroup:          priceGroup ?? null,
          requirePoNumber:       requirePoNumber,
          bcDebitorBookingGroup: debitorGroup ?? null,
          passwordHash,
          isActive:              portalAktiv,
        } as any,
      })
      customerId = newCustomer.id

      // Sæt felter der ikke er i den genererede Prisma-klient endnu
      await prisma.$executeRaw`
        UPDATE Customer
        SET phone     = ${phone ?? null},
            address   = ${address ?? null},
            city      = ${city ?? null},
            zipCode   = ${zipCode ?? null},
            bcBlocked = ${blocked ? 1 : 0}
        WHERE id = ${customerId}
      `
      action = 'created'
    }

    // ── Synkroniser kontaktpersoner ──────────────────────────────────────────
    const contactResults: any[] = []

    for (const c of contacts) {
      if (!c.email) continue
      const contactEmail = c.email.toLowerCase().trim()

      const existingContacts = await prisma.$queryRaw<any[]>`
        SELECT id FROM ContactUser WHERE email = ${contactEmail} LIMIT 1
      `

      if (existingContacts[0]) {
        await prisma.$executeRaw`
          UPDATE ContactUser
          SET name = ${c.name ?? contactEmail}, isActive = 1, updatedAt = ${new Date().toISOString()}
          WHERE email = ${contactEmail}
        `
        contactResults.push({ email: contactEmail, action: 'updated' })
      } else {
        const contactTempPw = randomBytes(6).toString('base64url')
        const contactPwHash = await hash(contactTempPw, 10)
        const contactId     = randomBytes(12).toString('hex')
        const now           = new Date().toISOString()

        await prisma.$executeRaw`
          INSERT INTO ContactUser (id, customerId, name, email, passwordHash, isActive, createdAt, updatedAt)
          VALUES (${contactId}, ${customerId}, ${c.name ?? contactEmail}, ${contactEmail}, ${contactPwHash}, 1, ${now}, ${now})
        `
        contactResults.push({
          email:       contactEmail,
          name:        c.name ?? contactEmail,
          action:      'created',
          tempPassword: contactTempPw,
        })
      }
    }

    return NextResponse.json({
      ok:          true,
      action,
      customerId,
      customerNo,
      tempPassword,
      contacts:    contactResults,
      loginUrl:    `${process.env.NEXTAUTH_URL ?? ''}/portal/login`,
      message:     action === 'created'
        ? `Kunde ${customerNo} oprettet. Midlertidigt password: ${tempPassword} — send til kunden.`
        : `Kunde ${customerNo} opdateret.`,
    })

  } catch (e: any) {
    console.error('sync-customer fejl:', e)
    return NextResponse.json({ error: 'Serverfejl: ' + e.message }, { status: 500 })
  }
}
