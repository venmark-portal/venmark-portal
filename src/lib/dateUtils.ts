/** Returnerer true hvis dato er en hverdag (man-fre) */
export function isBusinessDay(date: Date): boolean {
  const d = date.getDay()
  return d !== 0 && d !== 6
}

/** Tilføjer n hverdage til en dato */
export function addBusinessDays(date: Date, n: number): Date {
  const result = new Date(date)
  let added = 0
  while (added < n) {
    result.setDate(result.getDate() + 1)
    if (isBusinessDay(result)) added++
  }
  return result
}

/** Returnerer de næste n hverdage fra i dag */
export function nextBusinessDays(from: Date, count: number): Date[] {
  const days: Date[] = []
  const cursor = new Date(from)
  while (days.length < count) {
    cursor.setDate(cursor.getDate() + 1)
    if (isBusinessDay(cursor)) {
      days.push(new Date(cursor))
    }
  }
  return days
}

/**
 * Deadline for at bestille til en given leveringsdato.
 * Fredag levering → deadline torsdag kl. 12:00
 * Alle andre → dagen før kl. 14:00
 */
export function getDeadlineForDelivery(deliveryDate: Date): Date {
  // Find hverdagen FØR leveringen
  const prev = new Date(deliveryDate)
  do {
    prev.setDate(prev.getDate() - 1)
  } while (!isBusinessDay(prev))

  const isFriday = deliveryDate.getDay() === 5
  prev.setHours(isFriday ? 12 : 14, 0, 0, 0)
  return prev
}

/**
 * Næste forekomst af en ugedag (1=man … 5=fre), fra i morgen.
 * Springer over hvis deadline for den fundne dag allerede er passeret.
 */
export function nextOccurrenceOfWeekday(weekday: number): Date {
  const now    = new Date()
  const result = new Date(now)
  result.setDate(result.getDate() + 1)  // start fra i morgen
  result.setHours(0, 0, 0, 0)

  while (result.getDay() !== weekday) {
    result.setDate(result.getDate() + 1)
  }

  // Hvis deadline allerede er passeret for denne uge → næste uge
  const deadline = getDeadlineForDelivery(result)
  if (now > deadline) result.setDate(result.getDate() + 7)

  return result
}

/** Er datoen en arbejdsdag? (man-fre, ikke en generel Lukket-dag/helligdag) */
function isWorkingDay(d: Date, holidays: Set<string>): boolean {
  const wd = d.getDay()
  if (wd === 0 || wd === 6) return false // lør/søn
  return !holidays.has(localDateStr(d))
}

/** Lægger n ARBEJDSDAGE til `from` (from tælles ikke; springer weekender + helligdage over). */
function addWorkingDays(from: Date, n: number, holidays: Set<string>): Date {
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  let added = 0
  let guard = 0
  while (added < n && guard < 1000) {
    d.setDate(d.getDate() + 1)
    if (isWorkingDay(d, holidays)) added++
    guard++
  }
  return d
}

/**
 * Beregner tidligste leveringsdato for en vare med ugentlig bestillingsfrist.
 *
 * To modeller:
 *  • leadDays > 0  → levering = bestillingsfrist-dagen + leadDays ARBEJDSDAGE.
 *      Eksempel: frist onsdag (cutoffWeekday=3) + 5 arbejdsdage = onsdag ugen efter.
 *      Rykker korrekt hvis der er en helligdag imellem.
 *  • leadDays = 0  → LEGACY: levering fra mandagen ugen efter (fx laks, cutoffWeekday=2).
 *
 * @param cutoffWeekday  1=man … 5=fre
 * @param cutoffHour     0–23
 * @param now            aktuel tid (default: nu)
 * @param leadDays       arbejdsdage efter fristen (0 = mandag-gulv)
 * @param holidays       generelle Lukket-datoer (YYYY-MM-DD) til arbejdsdags-spring
 */
export function earliestDeliveryForItem(
  cutoffWeekday: number,
  cutoffHour: number,
  now: Date = new Date(),
  leadDays: number = 0,
  holidays: Set<string> = new Set(),
): Date {
  // Find mandagen i denne uge
  function getMonday(d: Date): Date {
    const m = new Date(d)
    const day = m.getDay() || 7 // 0(søn)→7, ellers 1-6
    m.setDate(m.getDate() - (day - 1))
    m.setHours(0, 0, 0, 0)
    return m
  }

  const thisMonday = getMonday(now)

  // Denne uges cutoff-tidspunkt
  const thisCutoff = new Date(thisMonday)
  thisCutoff.setDate(thisMonday.getDate() + (cutoffWeekday - 1))
  thisCutoff.setHours(cutoffHour, 0, 0, 0)

  // Hvis vi stadig er INDEN fristen → brug denne uges cutoff
  // Hvis vi har PASSERET fristen → brug næste uges cutoff
  let relevantCutoff: Date
  if (now < thisCutoff) {
    relevantCutoff = thisCutoff
  } else {
    relevantCutoff = new Date(thisCutoff)
    relevantCutoff.setDate(thisCutoff.getDate() + 7)
  }

  // NY model: leadtid i arbejdsdage EFTER fristen (fx frist onsdag + 5 = onsdag ugen efter).
  if (leadDays > 0) {
    const cutoffDay = new Date(relevantCutoff)
    cutoffDay.setHours(0, 0, 0, 0)
    return addWorkingDays(cutoffDay, leadDays, holidays)
  }

  // LEGACY: tidligste levering = mandagen UGEN EFTER den relevante cutoff
  const cutoffMonday = getMonday(relevantCutoff)
  const deliveryMonday = new Date(cutoffMonday)
  deliveryMonday.setDate(cutoffMonday.getDate() + 7)
  deliveryMonday.setHours(0, 0, 0, 0)
  return deliveryMonday
}

// ─── Leveringsmetode-baseret datoberegning ────────────────────────────────────

import type { BCShipmentMethod, BCCalendarDay } from '@/lib/businesscentral'

/** YYYY-MM-DD i lokal tid — undgår UTC-skift (toISOString giver forkert dato i UTC+2) */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Parser BC Time-felt ("HH:MM:SS.fffffff" eller "PTHHM...") til { hour, minute } */
export function parseCutoffTime(timeStr: string | null | undefined): { hour: number; minute: number } {
  if (!timeStr || timeStr.startsWith('00:00')) return { hour: 14, minute: 0 }
  const colon = timeStr.match(/^(\d{1,2}):(\d{2})/)
  if (colon) return { hour: parseInt(colon[1]), minute: parseInt(colon[2]) }
  const iso = timeStr.match(/PT(\d+)H(\d+)M/)
  if (iso) return { hour: parseInt(iso[1]), minute: parseInt(iso[2]) }
  return { hour: 14, minute: 0 }
}

/**
 * Beregner deadline for bestilling til en given leveringsdato og -metode.
 * Deadline = afsendelsesdagen (leveringsdato - transitDage) kl. cutoffTime.
 */
export function getDeadlineForMethodDelivery(
  deliveryDate: Date,
  method: BCShipmentMethod,
  calendarDays: BCCalendarDay[] = [],
): Date {
  const transit = method.sameDay ? 0 : (method.transitDays ?? 1)
  const { hour, minute } = parseCutoffTime(method.cutoffTime)
  const dispatch = new Date(deliveryDate)
  dispatch.setDate(dispatch.getDate() - transit)

  // Weekend-afsendelsesdag snappes til forrige fredag (kan ikke bestille lør/søn)
  const dispatchWd0 = dispatch.getDay()
  if (dispatchWd0 === 0) dispatch.setDate(dispatch.getDate() - 2) // søndag → fredag
  if (dispatchWd0 === 6) dispatch.setDate(dispatch.getDate() - 1) // lørdag → fredag

  const dispatchIso     = localDateStr(dispatch)
  const dispatchWeekday = dispatch.getDay()

  // Kalender-cutoff override for afsendelsesdagen
  let effectiveHour = hour, effectiveMinute = minute
  for (const d of calendarDays) {
    if (d.date === dispatchIso && d.cutoffTime && !d.cutoffTime.startsWith('00:00')) {
      if (d.shipmentMethodCode === method.code || d.shipmentMethodCode === '') {
        const p = parseCutoffTime(d.cutoffTime)
        effectiveHour = p.hour; effectiveMinute = p.minute
        if (d.shipmentMethodCode === method.code) break
      }
    }
  }
  // Fredag-loft: cutoff er aldrig efter 12:00 på fredage
  if (dispatchWeekday === 5 && effectiveHour > 12) { effectiveHour = 12; effectiveMinute = 0 }

  dispatch.setHours(effectiveHour, effectiveMinute, 0, 0)
  return dispatch
}

/**
 * Afsendelses-/effektiv dato (midnat) for en leveringsdato + metode = leveringsdato − transitdage,
 * weekend snappet til forrige fredag. Dette er den SHIP-side dato hvor vi skal have varen klar
 * (pakket/sendt). Bruges til at måle "kan skaffes til tiden"-dækning (daekketFra) mod afsendelses-
 * dagen i stedet for leveringsdagen — en auktionsvare skal kunne købes SENEST når vi afsender,
 * ikke når kunden modtager. (Spejler afsendelsesdag-delen af getDeadlineForMethodDelivery.)
 */
export function getDispatchDateForMethodDelivery(
  deliveryDate: Date,
  method: BCShipmentMethod,
): Date {
  const transit  = method.sameDay ? 0 : (method.transitDays ?? 1)
  const dispatch = new Date(deliveryDate)
  dispatch.setHours(0, 0, 0, 0)
  dispatch.setDate(dispatch.getDate() - transit)
  const wd = dispatch.getDay()
  if (wd === 0) dispatch.setDate(dispatch.getDate() - 2) // søndag → fredag
  if (wd === 6) dispatch.setDate(dispatch.getDate() - 1) // lørdag → fredag
  return dispatch
}

/** Parser BC Time STRENGT — null for blank/00:00 (modsat parseCutoffTime's 14:00-default). */
function parseTimeStrict(s: string | null | undefined): { hour: number; minute: number } | null {
  if (!s || s.startsWith('00:00') || s === 'PT0S') return null
  const colon = s.match(/^(\d{1,2}):(\d{2})/)
  if (colon) return { hour: parseInt(colon[1]), minute: parseInt(colon[2]) }
  const iso = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?/)
  if (iso) {
    const hh = parseInt(iso[1] ?? '0'), mm = parseInt(iso[2] ?? '0')
    return (hh === 0 && mm === 0) ? null : { hour: hh, minute: mm }
  }
  return null
}

/**
 * Effektiv/afsendelses-dato (midnat) — SPEJLER BC's OrderEffectiveDate (cu 50319).
 * = afsendelsesdag (leveringsdato − transit), MEN forskudt til arbejdsdagen FØR hvis leverings-
 * formens "Hentes kl" (cutoffTime) ≤ "Pak næste dag til kl." (packNextDayUntil) → pakkes dagen før.
 * Aldrig før i dag. Bruges til "kan skaffes"-dækning: en auktionsvare skal kunne købes senest på
 * den effektive dato. Fx afhentning i MORGEN TIDLIG (tidlig Hentes kl) → effektiv dato = I DAG →
 * cappes ved lager (auktionen når det ikke); afhentning 2 dage frem → effektiv i morgen → ubegrænset.
 */
export function getEffectiveDateForMethodDelivery(
  deliveryDate: Date,
  method: BCShipmentMethod,
  holidays: Set<string> = new Set(),
): Date {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const shipDate = getDispatchDateForMethodDelivery(deliveryDate, method) // levering − transit
  if (shipDate <= today) return today
  const cutoff    = parseTimeStrict(method.cutoffTime)
  const threshold = parseTimeStrict(method.packNextDayUntil)
  if (threshold && cutoff && (cutoff.hour * 60 + cutoff.minute) <= (threshold.hour * 60 + threshold.minute)) {
    const isWorking = (d: Date) => {
      const wd = d.getDay()
      if (wd === 0 || wd === 6) return false
      return !holidays.has(localDateStr(d))
    }
    const dayBefore = new Date(shipDate)
    dayBefore.setDate(dayBefore.getDate() - 1)
    while (!isWorking(dayBefore) && dayBefore > today) dayBefore.setDate(dayBefore.getDate() - 1)
    if (dayBefore < today) return today
    return dayBefore
  }
  return shipDate
}

/**
 * Genererer næste `count` gyldige leveringsdatoer for en given leveringsmetode.
 * Respekterer ugedagsmønster, portalkalender og bestillingstidspunkt.
 *
 * Logik (matcher PortalCalendarMgt.CanDeliverInternal i BC):
 *   1. Specifik kalenderpost (dato + metodekode) → DayType bestemmer
 *   2. Generel kalenderpost (dato + blank) → DayType bestemmer
 *   3. Ugedag-fallback via metodens Mon-Sun felter
 */
export function getDeliveryDatesForMethod(
  method: BCShipmentMethod,
  calendarDays: BCCalendarDay[],
  fromDate: Date,
  count: number,
): Date[] {
  const now = new Date()
  const { hour, minute } = parseCutoffTime(method.cutoffTime)
  const transit = method.sameDay ? 0 : (method.transitDays ?? 1)

  // Tidligste afsendelsesdato: i dag hvis cutoff ikke er passeret, ellers i morgen
  const today = new Date(fromDate)
  today.setHours(0, 0, 0, 0)
  const todayIso     = localDateStr(today)
  const todayWeekday = today.getDay()

  // Byg kalender-lookup: specific (dato+kode) har højere prioritet end general (dato+blank)
  const specificCal     = new Map<string, 'Closed' | 'Open'>()
  const generalCal      = new Map<string, 'Closed' | 'Open'>()
  const specificCutoffs = new Map<string, string>() // dato → cutoff-tid override (metodespecifik)
  const generalCutoffs  = new Map<string, string>() // dato → cutoff-tid override (generel)
  for (const d of calendarDays) {
    const status: 'Closed' | 'Open' | null = d.dayType === 1 ? 'Closed' : d.dayType === 2 ? 'Open' : null
    if (d.shipmentMethodCode === method.code) {
      if (status) specificCal.set(d.date, status)
      if (d.cutoffTime && !d.cutoffTime.startsWith('00:00')) specificCutoffs.set(d.date, d.cutoffTime)
    } else if (d.shipmentMethodCode === '') {
      if (status) generalCal.set(d.date, status)
      if (d.cutoffTime && !d.cutoffTime.startsWith('00:00')) generalCutoffs.set(d.date, d.cutoffTime)
    }
  }

  // Effektiv cutoff for i dag: kalender-override → fredag-loft (12:00) → metode-default
  const calCutoffStr = specificCutoffs.get(todayIso) ?? generalCutoffs.get(todayIso)
  const base = calCutoffStr ? parseCutoffTime(calCutoffStr) : { hour, minute }
  const effectiveHour   = (todayWeekday === 5 && base.hour > 12) ? 12 : base.hour
  const effectiveMinute = (todayWeekday === 5 && base.hour > 12) ? 0  : base.minute

  const cutoffToday = new Date(today)
  cutoffToday.setHours(effectiveHour, effectiveMinute, 0, 0)
  const earliestDispatch = new Date(today)
  if (now >= cutoffToday) earliestDispatch.setDate(earliestDispatch.getDate() + 1)

  // Ugedag-flags: JS getDay() → 0=søn,1=man,2=tir,3=ons,4=tor,5=fre,6=lør
  const delivers = [method.sun, method.mon, method.tue, method.wed, method.thu, method.fri, method.sat]

  const dates: Date[] = []
  const cursor = new Date(earliestDispatch)
  let limit = 400

  while (dates.length < count && limit-- > 0) {
    const delivery = new Date(cursor)
    delivery.setDate(cursor.getDate() + transit)
    const iso     = localDateStr(delivery)
    const weekday = delivery.getDay()

    let canDeliver: boolean
    if (specificCal.has(iso))     canDeliver = specificCal.get(iso) === 'Open'
    else if (generalCal.has(iso)) canDeliver = generalCal.get(iso)  === 'Open'
    else                          canDeliver = delivers[weekday]

    if (canDeliver) dates.push(new Date(delivery))
    cursor.setDate(cursor.getDate() + 1)
  }

  return dates
}

/** Datoformat: "man. 11/3" */
export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('da-DK', {
    weekday: 'short',
    day:     'numeric',
    month:   'numeric',
  })
}

/** Datoformat: "Mandag d. 11. marts" */
export function formatLongDate(date: Date): string {
  return date.toLocaleDateString('da-DK', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
  })
}
