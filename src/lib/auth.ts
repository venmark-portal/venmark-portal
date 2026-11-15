import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { prisma } from './prisma'
import { getPortalOrderAccesses } from './businesscentral'
import { indloesAdgang } from './impersonation'
import {
  medarbejderMedEmail, medarbejderForPinBruger, medarbejderFelter, hentMedarbejder,
  brugerForRolle, startBruger, huskRolle, ROLLER, type Rolle,
} from './medarbejder'

/** Login-brugerens felter → tokenet. Bruges ved login og ved rolleskift (alt skrives forfra). */
function fyldToken(token: any, user: any) {
  token.sub                   = user.id
  token.name                  = user.name
  token.email                 = user.email ?? null
  token.role                  = user.role
  token.bcCustomerNumber      = user.bcCustomerNumber
  token.bcPriceGroup          = user.bcPriceGroup
  token.bcChainPriceGroup     = user.bcChainPriceGroup ?? ''
  token.requirePoNumber       = user.requirePoNumber ?? false
  token.bcDebitorBookingGroup = user.bcDebitorBookingGroup ?? ''
  token.isContact             = user.isContact ?? false
  // Tom for en rigtig kunde — kun sat når en admin kigger med.
  token.impersonatedBy = user.impersonatedBy ?? ''
  // Lager-appen: hvem scanner, hvor, og hvad må han.
  token.lagerInitials   = user.lagerInitials ?? ''
  token.lagerLocation   = user.lagerLocation ?? ''
  token.lagerCanCount   = user.lagerCanCount ?? false
  token.lagerCanPack    = user.lagerCanPack ?? false
  token.lagerBcUserName = user.lagerBcUserName ?? ''
  // Medarbejder med flere roller (tom = almindeligt login).
  token.medarbejderId     = user.medarbejderId ?? ''
  token.medarbejderNavn   = user.medarbejderNavn ?? ''
  token.medarbejderRoller = user.medarbejderRoller ?? []
  token.medarbejderRolle  = user.medarbejderRolle ?? ''
  // "Bestil på vegne af": aktiv kunde starter som login-kunden selv.
  // active* = valgt butik; token.bcCustomerNumber/bcPriceGroup/... forbliver
  // login-kundens EGET (parent) og bruges kun til adgangs-validering.
  token.activeCustomerNumber  = user.bcCustomerNumber
  token.activeCustomerName    = user.name ?? ''
  token.activePriceGroup      = user.bcPriceGroup ?? ''
  token.activeChainPriceGroup = user.bcChainPriceGroup ?? ''
  token.activePostingGroup    = user.bcDebitorBookingGroup ?? ''
}

/** PIN-login: er brugeren koblet til en medarbejder, kommer rolleskiftet med. */
async function medMedarbejder<T extends Record<string, any>>(rolle: 'lager' | 'chauffoer', b: T): Promise<T> {
  const m = await medarbejderForPinBruger(rolle, b.id).catch(() => null)
  return m ? { ...b, ...medarbejderFelter(m, rolle) } : b
}

export const authOptions: NextAuthOptions = {
  providers: [
    // Medarbejder: e-mail + kode → den rolle man sidst brugte (se src/lib/medarbejder.ts).
    CredentialsProvider({
      id: 'medarbejder',
      name: 'Medarbejder',
      credentials: {
        email:    { label: 'Email', type: 'email' },
        password: { label: 'Adgangskode', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const m = await medarbejderMedEmail(credentials.email).catch(() => null)
        if (!m || !m.aktiv || !m.passwordHash) return null
        if (!(await compare(credentials.password, m.passwordHash))) return null
        return (await startBruger(m)) as any
      },
    }),

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
              bcChainPriceGroup:    (customer as any).bcChainPriceGroup ?? '',
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
                 c."bcChainPriceGroup",
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
              bcChainPriceGroup:    contactRow.bcChainPriceGroup ?? '',
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

    // "Gå ind som kunde" — admin ser portalen med kundens øjne. Ingen adgangskode:
    // billetten ER beviset, og den kan kun udstedes af en der ALLEREDE er logget ind
    // som admin (se src/lib/impersonation.ts). Engangs, udløber på 2 minutter.
    CredentialsProvider({
      id: 'impersonate',
      name: 'Som kunde',
      credentials: { token: { label: 'Billet', type: 'text' } },
      async authorize(credentials) {
        const adgang = await indloesAdgang(credentials?.token ?? '')
        if (!adgang) return null

        const customer = await prisma.customer.findUnique({ where: { id: adgang.customerId } })
        if (!customer) return null
        // BEMÆRK: der tjekkes med vilje IKKE isActive/bcBlocked. Det er netop den
        // spærrede kunde man har mest brug for at kigge med hos, når man skal finde ud
        // af hvorfor hun ikke kan komme ind.

        return {
          id:                    customer.id,
          email:                 customer.email,
          name:                  customer.name,
          role:                  'customer' as const,
          bcCustomerNumber:      customer.bcCustomerNumber,
          bcPriceGroup:          customer.bcPriceGroup ?? '',
          bcChainPriceGroup:     (customer as any).bcChainPriceGroup ?? '',
          requirePoNumber:       customer.requirePoNumber,
          bcDebitorBookingGroup: customer.bcDebitorBookingGroup ?? '',
          isContact:             false,
          // Bæres med ud i sessionen og driver båndet øverst på hver side.
          impersonatedBy:        adgang.adminName || adgang.adminEmail,
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
        return medMedarbejder('chauffoer', { id: driver.id, name: driver.name, role: 'driver' as const })
      },
    }),

    // Lager-appen (/lager): håndterminal med navn + PIN. Samme mønster som chauffør —
    // en lagermand skal ikke taste email og kodeord med handsker på.
    CredentialsProvider({
      id: 'lager',
      name: 'Lager',
      credentials: {
        userId: { label: 'Medarbejder', type: 'text' },
        pin:    { label: 'PIN',         type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.userId || !credentials?.pin) return null
        const rows = await prisma.$queryRaw<any[]>`
          SELECT id, name, initials, "pinHash", "defaultLocation", "canCount", "canPack", "bcUserName"
          FROM "LagerUser"
          WHERE id = ${credentials.userId} AND "isActive" = true LIMIT 1
        `
        const u = rows[0]
        if (!u) return null
        const valid = await compare(credentials.pin, u.pinHash)
        if (!valid) return null
        return (await medMedarbejder('lager', {
          id:              u.id,
          name:            u.name,
          role:            'lager' as const,
          lagerInitials:   u.initials ?? '',
          lagerLocation:   u.defaultLocation ?? '',
          lagerCanCount:   !!u.canCount,
          lagerCanPack:    !!u.canPack,
          lagerBcUserName: u.bcUserName ?? '',
        })) as any
      },
    }),
  ],

  session: { strategy: 'jwt' },

  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) fyldToken(token, user)

      // Rolleskift: update({ rolle }). Rollen slås ALTID op i databasen igen — klienten
      // kan kun bede om en rolle medarbejderen faktisk har.
      if (trigger === 'update' && session && 'rolle' in (session as any)) {
        const mid  = (token as any).medarbejderId as string
        const ny   = String((session as any).rolle) as Rolle
        const m    = mid && ROLLER.some(r => r.rolle === ny) ? await hentMedarbejder(mid).catch(() => null) : null
        const bruger = m ? await brugerForRolle(m, ny) : null
        if (bruger) {
          fyldToken(token, bruger)
          await huskRolle(m!.id, ny)
        }
        return token
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
          ;(token as any).activeChainPriceGroup = (token as any).bcChainPriceGroup ?? ''
          ;(token as any).activePostingGroup   = token.bcDebitorBookingGroup ?? ''
        } else {
          const list  = await getPortalOrderAccesses(parent)
          const match = list.find(a => a.customerNo === target)
          if (match) {
            ;(token as any).activeCustomerNumber = match.customerNo
            ;(token as any).activeCustomerName   = match.customerName
            ;(token as any).activePriceGroup     = match.priceGroup
            ;(token as any).activeChainPriceGroup = match.chainPriceGroup ?? ''
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
        ;(session.user as any).impersonatedBy       = (token as any).impersonatedBy ?? ''
        ;(session.user as any).lagerInitials        = (token as any).lagerInitials ?? ''
        ;(session.user as any).lagerLocation        = (token as any).lagerLocation ?? ''
        ;(session.user as any).lagerCanCount        = (token as any).lagerCanCount ?? false
        ;(session.user as any).lagerCanPack         = (token as any).lagerCanPack ?? false
        ;(session.user as any).lagerBcUserName      = (token as any).lagerBcUserName ?? ''
        ;(session.user as any).requirePoNumber      = token.requirePoNumber ?? false
        // Medarbejder med flere roller → rolleskiftet (components/RolleSkift.tsx).
        ;(session.user as any).medarbejder = (token as any).medarbejderId
          ? {
              id:     (token as any).medarbejderId,
              navn:   (token as any).medarbejderNavn,
              roller: (token as any).medarbejderRoller ?? [],
              rolle:  (token as any).medarbejderRolle,
            }
          : null

        // Login-kundens EGET nr. (parent) — bevares til adgangs-validering
        ;(session.user as any).parentCustomerNumber = token.bcCustomerNumber

        // ── ET CHOKE-POINT ──────────────────────────────────────────────────
        // bcCustomerNumber/bcPriceGroup/bcDebitorBookingGroup eksponeres som den
        // AKTIVE kunde (valgt butik). Så følger ALLE eksisterende BC-kald automatisk
        // den valgte butik — uden at røre 17 kald-steder. Ved "sig selv" = parent.
        ;(session.user as any).bcCustomerNumber      = (token as any).activeCustomerNumber   ?? token.bcCustomerNumber
        ;(session.user as any).bcPriceGroup          = (token as any).activePriceGroup       ?? token.bcPriceGroup
        ;(session.user as any).bcChainPriceGroup     = (token as any).activeChainPriceGroup  ?? (token as any).bcChainPriceGroup ?? ''
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
