import { getPortalOrderAccesses } from './businesscentral'

/**
 * "Bestil på vegne af / flere butikker".
 *
 * Login-kunden (parent/kædekontor) kan vælge at agere som en af sine linkede
 * butikker. Det valgte kundenr. ligger i JWT-sessionen som `activeCustomerNumber`
 * (signeret server-side, kan ikke forfalskes af klienten). Alle BC-kald skal bruge
 * den AKTIVE kunde — ikke login-kundens eget nr.
 *
 * `bcCustomerNumber` = login-kundens eget nr. (parent, altid).
 * `activeCustomerNumber` = valgt butik (eller = parent hvis ikke skiftet).
 */

/**
 * Kundenr. der bruges i alle BC-kald. Session-callback'et eksponerer allerede
 * `bcCustomerNumber` som den AKTIVE kunde (valgt butik), så denne = den værdi.
 * `activeCustomerNumber` er et eksplicit alias for samme.
 */
export function getActiveCustomerNo(session: any): string {
  const active = (session?.user as any)?.activeCustomerNumber as string | undefined
  const bc     = (session?.user as any)?.bcCustomerNumber as string | undefined
  return (active && active.trim() ? active : bc) ?? ''
}

/** Login-kundens EGET nr. (parent) — bruges til adgangs-validering. */
export function getParentCustomerNo(session: any): string {
  const parent = (session?.user as any)?.parentCustomerNumber as string | undefined
  // Fallback for gamle sessions uden parent-felt: bcCustomerNumber
  return (parent && parent.trim() ? parent : (session?.user as any)?.bcCustomerNumber) ?? ''
}

/** True hvis kunden lige nu bestiller på vegne af en anden butik. */
export function isOnBehalf(session: any): boolean {
  const active = getActiveCustomerNo(session)
  const parent = getParentCustomerNo(session)
  return Boolean(active && parent && active !== parent)
}

/**
 * Server-side gen-validering (defense in depth): må `targetNo` bestilles til af
 * `parentNo`? Sig selv er altid tilladt. Ellers skal butikken være på BC-adgangs-
 * listen. Bruges før ordre oprettes — stol ALDRIG på et klient-leveret kundenr.
 */
export async function isCustomerAllowed(parentNo: string, targetNo: string): Promise<boolean> {
  if (!targetNo || !parentNo) return false
  if (targetNo === parentNo) return true
  const list = await getPortalOrderAccesses(parentNo)
  return list.some(a => a.customerNo === targetNo)
}
