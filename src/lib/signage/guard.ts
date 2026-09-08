// Ét sted at afgøre hvad den indloggede må på skærmene, så ingen rute kan
// glemme tjekket.
//
// To slags brugere:
//  · Almindelig portal-admin  → signage-superadmin. Har i forvejen adgang til
//    kunder, ordrer og fakturaer, så det ville være teater at spærre skærmene.
//  · signageLimited-bruger    → må KUN det ScreenAccess giver. Til folk der skal
//    passe en skærm uden at kunne se resten af portalen (marketing, produktion).

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  accessForUser, isLimitedUser, mindstRolle, roleForScreen,
  type AccessRow, type Screen, type SignageRole,
} from './screens'

export interface Bruger {
  userId:  string
  limited: boolean
  access:  AccessRow[]
}

/** Returnerer brugeren, eller null hvis der slet ikke er en admin-session. */
export async function signageBruger(): Promise<Bruger | null> {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') return null

  const userId = String((session.user as any)?.id ?? '')
  if (!userId) return null

  const limited = await isLimitedUser(userId)
  return { userId, limited, access: limited ? await accessForUser(userId) : [] }
}

export function afvis(): NextResponse {
  return new NextResponse('Unauthorized', { status: 401 })
}

/** Superadmin = ubegrænset portal-admin. Kun de må oprette/slette skærme og grupper. */
export function erSuperadmin(b: Bruger): boolean {
  return !b.limited
}

export function rolle(b: Bruger, screen: Screen): SignageRole | null {
  return roleForScreen(screen, b.access, b.limited)
}

export function maa(b: Bruger, screen: Screen, kraevet: SignageRole): boolean {
  return mindstRolle(rolle(b, screen), kraevet)
}

/** Kun de skærme brugeren overhovedet må se. */
export function synligeSkaerme(b: Bruger, alle: Screen[]): Screen[] {
  if (!b.limited) return alle
  return alle.filter(s => rolle(b, s) !== null)
}
