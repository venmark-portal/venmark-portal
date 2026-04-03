import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { prisma } from './prisma'

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
        if (customer && customer.isActive) {
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
          SELECT cu.*, c.id as customerId_ref, c.bcCustomerNumber, c.bcPriceGroup,
                 c.requirePoNumber, c.bcDebitorBookingGroup, c.isActive as customerIsActive
          FROM ContactUser cu
          JOIN Customer c ON c.id = cu.customerId
          WHERE cu.email = ${emailLower}
          LIMIT 1
        `
        const contactRow = contactRows[0]
        if (contactRow && contactRow.isActive && contactRow.customerIsActive) {
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
          SELECT id, name, pinHash FROM DriverUser
          WHERE id = ${credentials.driverId} AND isActive = 1 LIMIT 1
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
    async jwt({ token, user }) {
      if (user) {
        token.role                  = (user as any).role
        token.bcCustomerNumber      = (user as any).bcCustomerNumber
        token.bcPriceGroup          = (user as any).bcPriceGroup
        token.requirePoNumber       = (user as any).requirePoNumber ?? false
        token.bcDebitorBookingGroup = (user as any).bcDebitorBookingGroup ?? ''
        token.isContact             = (user as any).isContact ?? false
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as any).id                   = token.sub
        ;(session.user as any).role                 = token.role
        ;(session.user as any).bcCustomerNumber     = token.bcCustomerNumber
        ;(session.user as any).bcPriceGroup         = token.bcPriceGroup
        ;(session.user as any).requirePoNumber      = token.requirePoNumber ?? false
        ;(session.user as any).bcDebitorBookingGroup = token.bcDebitorBookingGroup ?? ''
        ;(session.user as any).isContact            = token.isContact ?? false
      }
      return session
    },
  },

  pages: {
    signIn: '/portal/login',
    error:  '/portal/login',
  },
}
