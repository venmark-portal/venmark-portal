import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { prisma } from './prisma'
import { getPortalOrderAccesses } from './businesscentral'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'customer',
      name: 'Kunde',
      credentials: {
        email:    { label: 'Email', type: 'email' },
        password: { label: 'Adgangskode', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const emailLower = credentials.email.toLowerCase()

        // ── Tjek hoved-kundekonto ───────────────────────────────
        const customer = await prisma.customer.findUnique({
          where: { email: emailLower },
        })
        if (customer && customer.isActive && !(customer as any).bcBlocked) {
          const valid = await compare(credentials.password, customer.passwordHash)
          if (valid) {
            return {
              id:                   customer.id,
              email:                customer.email,
              name:                 customer.name,
              role:                 'customer' as const,
              bcCustomerNumber:     customer.bcCustomerNumber,
              bcPriceGroup:         customer.bcPriceGroup ?? '',
              requirePoNumber:      customer.requirePoNumber,
              bcDebitorBookingGroup: customer.bcDebitorBookingGroup ?? '',
              isContact:            false,
            }
          }
        }

        // ── Tjek kontakt-bruger (ansat der bestiller for kunden) ─
        // Bruger $queryRaw pga. ContactUser er ny model og prisma generate er ikke kørt
        const contactRows = await prisma.$queryRaw<any[]>`
          SELECT cu.*, c.id as customerId_ref, c."bcCustomerNumber", c."bcPriceGroup",
                 c."requirePoNumber", c."bcDebitorBookingGroup", c."isActive" as "customerIsActive",
                 c."bcBlocked" as "customerBcBlocked"
          FROM "ContactUser" cu
          JOIN "Customer" c ON c.id = cu."customerId"
          WHERE cu.email = ${emailLower}
          LIMIT 1
        `
        const contactRow = contactRows[0]
        if (contactRow && contactRow.isActive && contactRow.customerIsActive && !contactRow.customerBcBlocked) {
          const valid = await compare(credentials.password, contactRow.passwordHash)
          if (valid) {
            return {
              id:                   contactRow.customerId,  // customerId til DB-opslag
              email:                contactRow.email,
              name:                 contactRow.name,
              role:                 'customer' as const,
              bcCustomerNumber:     contactRow.bcCustomerNumber,
              bcPriceGroup:         contactRow.bcPriceGroup ?? '',
              requirePoNumber:      Boolean(contactRow.requirePoNumber),
              bcDebitorBookingGroup: contactRow.bcDebitorBookingGroup ?? '',
              isContact:            true,
              contactId:            contactRow.id,
            }
          }
        }

        return null
      },
    }),

    CredentialsProvider({
      id: 'admin',
      name: 'Admin',
      credentials: {
        email:    { label: 'Email', type: 'email' },
        password: { label: 'Adgangskode', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const admin = await prisma.adminUser.findUnique({
          where: { email: credentials.email.toLowerCase() },
        })
        if (!admin) return null

        const valid = await compare(credentials.password, admin.passwordHash)
        if (!valid) return null

        return {
          id:    admin.id,
          email: admin.email,
          name:  admin.name,
          role:  'admin' as const,
        }
      },
    }),

    CredentialsProvider({
      id: 'driver',
      name: 'Chauffør',
      credentials: {
        driverId: { label: 'Chauffør', type: 'text' },
        pin:      { label: 'PIN',      type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.driverId || !credentials?.pin) return null
        const rows = await prisma.$queryRaw<any[]>`
          SELECT id, name, "pinHash" FROM "DriverUser"
          WHERE id = ${credentials.driverId} AND "isActive" = true LIMIT 1
        `
        const driver = rows[0]
        if (!driver) return null
        const valid = await compare(credentials.pin, driver.pinHash)
        if (!valid) return null
        return { id: driver.id, name: driver.name, role: 'driver' as const }
      },
    }),
  ],

  session: { strategy: 'jwt' },

  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role                  = (user as any).role
        token.bcCustomerNumber      = (user as any).bcCustomerNumber
        token.bcPriceGroup          = (user as any).bcPriceGroup
        token.requirePoNumber       = (user as any).requirePoNumber ?? false
        token.bcDebitorBookingGroup = (user as any).bcDebitorBookingGroup ?? ''
        token.isContact             = (user as any).isContact ?? false
        // "Bestil på vegne af": aktiv kunde starter som login-kunden selv.
        // active* = valgt butik; token.bcCustomerNumber/bcPriceGroup/... forbliver
        // login-kundens EGET (parent) og bruges kun til adgangs-validering.
        ;(token as any).activeCustomerNumber = (user as any).bcCustomerNumber
        ;(token as any).activeCustomerName   = (user as any).name ?? ''
        ;(token as any).activePriceGroup     = (user as any).bcPriceGroup ?? ''
        ;(token as any).activePostingGroup   = (user as any).bcDebitorBookingGroup ?? ''
      }

      // Klienten beder om at skifte aktiv kunde (kunde-vælger). Vi VALIDERER altid
      // server-side mod BC-adgangslisten — stol aldrig på det klient-leverede nr.
      // Prisgruppe/bogføringsgruppe hentes fra den AUTORITATIVE BC-liste (ikke klienten),
      // så priser/PO-krav følger den valgte butik.
      if (trigger === 'update' && session && 'activeCustomerNumber' in (session as any)) {
        const parent = (token as any).bcCustomerNumber as string
        const target = ((session as any).activeCustomerNumber as string | undefined)?.trim() ?? ''
        if (!target || target === parent) {
          // Nulstil til login-kunden selv
          ;(token as any).activeCustomerNumber = parent
          ;(token as any).activeCustomerName   = (token.name as string) ?? ''
          ;(token as any).activePriceGroup     = token.bcPriceGroup ?? ''
          ;(token as any).activePostingGroup   = token.bcDebitorBookingGroup ?? ''
        } else {
          const list  = await getPortalOrderAccesses(parent)
          const match = list.find(a => a.customerNo === target)
          if (match) {
            ;(token as any).activeCustomerNumber = match.customerNo
            ;(token as any).activeCustomerName   = match.customerName
            ;(token as any).activePriceGroup     = match.priceGroup
            ;(token as any).activePostingGroup   = match.postingGroup
          }
          // Ingen match → ignorér (behold nuværende aktiv kunde)
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as any).id                   = token.sub
        ;(session.user as any).role                 = token.role
        ;(session.user as any).isContact            = token.isContact ?? false
        ;(session.user as any).requirePoNumber      = token.requirePoNumber ?? false

        // Login-kundens EGET nr. (parent) — bevares til adgangs-validering
        ;(session.user as any).parentCustomerNumber = token.bcCustomerNumber

        // ── ET CHOKE-POINT ──────────────────────────────────────────────────
        // bcCustomerNumber/bcPriceGroup/bcDebitorBookingGroup eksponeres som den
        // AKTIVE kunde (valgt butik). Så følger ALLE eksisterende BC-kald automatisk
        // den valgte butik — uden at røre 17 kald-steder. Ved "sig selv" = parent.
        ;(session.user as any).bcCustomerNumber      = (token as any).activeCustomerNumber   ?? token.bcCustomerNumber
        ;(session.user as any).bcPriceGroup          = (token as any).activePriceGroup       ?? token.bcPriceGroup
        ;(session.user as any).bcDebitorBookingGroup = (token as any).activePostingGroup     ?? token.bcDebitorBookingGroup ?? ''

        // Aliaser til kunde-vælgeren
        ;(session.user as any).activeCustomerNumber = (token as any).activeCustomerNumber ?? token.bcCustomerNumber
        ;(session.user as any).activeCustomerName   = (token as any).activeCustomerName ?? token.name ?? ''
      }
      return session
    },
  },

  pages: {
    signIn: '/portal/login',
    error:  '/portal/login',
  },
}
