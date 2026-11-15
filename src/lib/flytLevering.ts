// Flyt leveringsdagen på en åben ordre — fra ordresiden og fra svar-robotten.
//
// Portalen tjekker det den er facit for: at ordren er kundens, at den nuværende dag ikke er
// for tæt på (frist/afsendelse), at den nye dag er en af leveringsformens leveringsdage med
// fristen i behold. Ligger der allerede en åben, upakket ordre til den nye leverance (én ordre pr.
// leverance), lægges ordren sammen med den. BC (cu 50482) tjekker disponibel pr. vare til den nye
// dag og genberegner afsendelses-/bogføringsdato og priser.
//
// Altid i to trin: tjek (udfoer=false) → kunden ser hvad der sker og bekræfter → flyt.

import { prisma } from '@/lib/prisma'
import {
  getCustomerOrders, getPortalLineStatuses, getPortalShipmentMethods, getPortalCalendarDays,
  changeBCOrderDeliveryDate, mergeBCOrderInto, type BCFlytSvar, type BCCustomerOrder, type BCShipmentMethod, type BCCalendarDay,
} from '@/lib/businesscentral'
import { getDeliveryDatesForMethod, getDeadlineForMethodDelivery } from '@/lib/dateUtils'
import { ymdLokal, aabneOrdrerPrAfsendelsesdag, afsendelsesdagForLevering } from '@/lib/aabenOrdre'
import { bcOrdreLevering } from '@/lib/tilfoejOrdre'
import { sendKontorBesked } from '@/lib/kontorBesked'

export interface FlytKunde {
  customerId: string   // portal-id
  customerNo: string   // aktiv BC-kunde
  navn:       string
  somAdmin?:  string | null
}

export interface FlytResultat extends Partial<BCFlytSvar> {
  ok:          boolean
  fejl?:       string
  flyttet?:    boolean
  ordre:       string
  fra?:        string   // nuværende leveringsdato
  til?:        string
  /** Frist for den nye dag (ISO). */
  frist?:      string
  /** Dage ordren kan flyttes til, når den ønskede ikke kan bruges. */
  muligeDage?: string[]
}

interface Muligheder {
  o:      BCCustomerOrder
  metode: BCShipmentMethod
  kal:    BCCalendarDay[]
  fra:    string     // nuværende leveringsdato
  dage:   string[]   // mulige nye leveringsdage (fristen i behold), uden den nuværende
}

const fejl = (ordre: string, tekst: string, ekstra: Partial<FlytResultat> = {}): FlytResultat => ({ ok: false, ordre, fejl: tekst, ...ekstra })

/** Ordren, dens nuværende leveringsdag og de dage den kan flyttes til — eller hvorfor den ikke kan. */
export async function flytMuligheder(customerNo: string, ordrenr: string): Promise<Muligheder | FlytResultat> {
  ordrenr = ordrenr.trim().toUpperCase()
  const fra90 = new Date(); const til90 = new Date(); til90.setDate(til90.getDate() + 90)
  const [ordrer, metoder, kal] = await Promise.all([
    getCustomerOrders(customerNo),
    getPortalShipmentMethods().catch(() => [] as BCShipmentMethod[]),
    getPortalCalendarDays(ymdLokal(fra90), ymdLokal(til90)).catch(() => [] as BCCalendarDay[]),
  ])
  // Kun kundens egne åbne ordrer — ordrenummeret kommer fra kunden/robotten og stoles ikke på.
  const o = ordrer.find(x => x.number.toUpperCase() === ordrenr)
  if (!o) return fejl(ordrenr, 'Ordren findes ikke blandt dine åbne ordrer.')

  const metode = metoder.find(m => m.code === o.shipmentMethodCode)
  if (!metode) return fejl(ordrenr, 'Ordren har ingen leveringsform, som portalen kender. Ring til kontoret.')

  const linjer = (await getPortalLineStatuses(o.number, { frisk: true }).catch(() => null)) ?? []
  if (linjer.some(l => (l.headerPackedBy ?? '').trim() !== '')) return fejl(ordrenr, 'Ordren er pakket og kan ikke flyttes. Ring til kontoret.')

  const fra = bcOrdreLevering(o, linjer.map(l => l.shipmentDate), metoder)
  if (!fra) return fejl(ordrenr, 'Ordren har ingen leveringsdato. Ring til kontoret.')

  // Den nuværende leverance må ikke være i gang: fristen for den skal være i behold.
  const nu = new Date()
  if (nu > getDeadlineForMethodDelivery(new Date(`${fra}T00:00:00`), metode, kal)) {
    return fejl(ordrenr, 'Fristen for ordrens nuværende leveringsdag er passeret, så den er måske allerede i gang. Ring til kontoret.', { fra })
  }

  const dage = getDeliveryDatesForMethod(metode, kal, nu, 20)
    .filter(d => nu <= getDeadlineForMethodDelivery(d, metode, kal))
    .map(ymdLokal)
    .filter(d => d !== fra)
  return { o, metode, kal, fra, dage }
}

export async function flytLeveringsdag(k: FlytKunde, ordrenr: string, nyDato: string, udfoer: boolean): Promise<FlytResultat> {
  ordrenr = ordrenr.trim().toUpperCase()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nyDato)) return fejl(ordrenr, 'Datoen skal skrives som ÅÅÅÅ-MM-DD.')

  const m = await flytMuligheder(k.customerNo, ordrenr)
  if ('ok' in m) return m
  const { o, metode, kal, fra, dage } = m
  if (fra === nyDato) return fejl(ordrenr, 'Ordren skal allerede leveres den dag.', { fra })
  // Den nye dag skal være en af leveringsformens leveringsdage med fristen i behold.
  if (!dage.includes(nyDato)) {
    return fejl(ordrenr, 'Den dag kan ordren ikke leveres med ordrens leveringsform (eller fristen er passeret).', { fra, muligeDage: dage.slice(0, 8) })
  }
  const nyFrist = getDeadlineForMethodDelivery(new Date(`${nyDato}T00:00:00`), metode, kal)

  // Én ordre pr. leverance: ligger der allerede en åben, UPAKKET ordre til den nye dag, lægges
  // varerne på den (som "Tilføj til ordre"), og den flyttede ordre slettes. Er den pakket, kan den
  // ikke få mere med — så flyttes ordren som en selvstændig ordre, ligesom ved en ny bestilling.
  const andre = await aabneOrdrerPrAfsendelsesdag(k.customerNo, o.shipmentMethodCode, metode, nyDato).catch(() => new Map())
  const fundet = andre.get(afsendelsesdagForLevering(nyDato, metode))
  const maal = fundet && fundet.bcOrderNumber !== o.number && !fundet.pakket ? fundet.bcOrderNumber as string : null

  let bc: BCFlytSvar
  try {
    bc = maal
      ? await mergeBCOrderInto(o.id, maal, nyDato, !udfoer)
      : await changeBCOrderDeliveryDate(o.id, nyDato, !udfoer)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Før BC-udvidelsen er synkroniseret, findes handlingen ikke.
    if (/changeDeliveryDate|mergeIntoOrder|MethodNotImplemented|BC 404/.test(msg)) return fejl(ordrenr, 'Flytning af leveringsdag er ikke slået til endnu. Ring til kontoret.', { fra })
    return fejl(ordrenr, 'BC svarede ikke. Prøv igen om lidt, eller ring til kontoret.', { fra })
  }

  const res: FlytResultat = { ...bc, ok: !!bc.ok, ordre: o.number, fra, til: nyDato, frist: nyFrist.toISOString() }
  if (!bc.ok || !udfoer) return res

  // Portalens egen kopi af ordren (portal-oprettede ordrer) følger med — ved sammenlægning peger
  // den nu på målordren (den flyttede ordre findes ikke længere i BC).
  await prisma.order.updateMany({
    where: { customerId: k.customerId, bcOrderNumber: o.number },
    data:  {
      deliveryDate: new Date(`${nyDato}T00:00:00`), deadline: nyFrist,
      ...(maal ? { bcOrderNumber: maal, bcOrderId: fundet!.bcOrderId } : {}),
    },
  }).catch(err => console.error('[flyt-levering] portal-ordre ikke opdateret', o.number, err))

  const hvad = maal ? `lagt sammen med ordre ${maal}` : `afsendelse ${bc.afsendelsesdato}`
  console.log(`[flyt-levering] ${k.customerNo} ${o.number} ${fra} → ${nyDato} (${hvad}, ${bc.priserOpdateret ?? 0} priser)${k.somAdmin ? ` af ${k.somAdmin}` : ''}`)
  // Kontoret skal vide det — pakkeriet planlægger efter dagen. Ikke når kontoret selv gør det som kunden.
  if (!k.somAdmin) {
    const tekst = maal
      ? `[Leveringsdag flyttet] Ordre ${o.number} (${fra}) er flyttet til ${nyDato} og lagt sammen med ordre ${maal}. Ordre ${o.number} er slettet.`
      : `[Leveringsdag flyttet] Ordre ${o.number} er flyttet fra ${fra} til ${nyDato} (afsendelse ${bc.afsendelsesdato}).`
    await sendKontorBesked(k, tekst).catch(err => console.error('[flyt-levering] besked til kontoret fejlede', err))
  }
  return { ...res, flyttet: true }
}
