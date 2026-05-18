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

/**
 * Beregner tidligste leveringsdato for en vare med ugentlig bestillingsfrist.
 *
 * Eksempel: Laks — cutoffWeekday=2 (tirsdag), cutoffHour=7
 *   → Bestilles tirsdag kl 07:00 til leverandør
 *   → Kan leveres fra mandagen ugen efter
 *
 * @param cutoffWeekday  1=man … 5=fre
 * @param cutoffHour     0–23
 * @param now            aktuel tid (default: nu)
 */
export function earliestDeliveryForItem(
  cutoffWeekday: number,
  cutoffHour: number,
  now: Date = new Date()
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

  // Tidligste levering = mandagen UGEN EFTER den relevante cutoff
  const cutoffMonday = getMonday(relevantCutoff)
  const deliveryMonday = new Date(cutoffMonday)
  deliveryMonday.setDate(cutoffMonday.getDate() + 7)
  deliveryMonday.setHours(0, 0, 0, 0)
  return deliveryMonday
}

// ─── Leveringsmetode-baseret datoberegning ────────────────────────────────────

import type { BCShipmentMethod, BCCalendarDay } from '@/lib/businesscentral'

/** Parser BC Time-felt ("HH:MM:SS.fffffff" eller "PTHHM...") til { hour, minute } */
export function parseCutoffTime(timeStr: string | null | undefined): { hour: number; minute: number } {
  if (!timeStr) return { hour: 14, minute: 0 }
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
export function getDeadlineForMethodDelivery(deliveryDate: Date, method: BCShipmentMethod): Date {
  const transit = method.sameDay ? 0 : (method.transitDays ?? 1)
  const { hour, minute } = parseCutoffTime(method.cutoffTime)
  const dispatch = new Date(deliveryDate)
  dispatch.setDate(dispatch.getDate() - transit)
  dispatch.setHours(hour, minute, 0, 0)
  return dispatch
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
  const cutoffToday = new Date(today)
  cutoffToday.setHours(hour, minute, 0, 0)
  const earliestDispatch = new Date(today)
  if (now >= cutoffToday) earliestDispatch.setDate(earliestDispatch.getDate() + 1)

  // Byg kalender-lookup: specific (dato+kode) har højere prioritet end general (dato+blank)
  const specificCal = new Map<string, 'Closed' | 'Open'>()
  const generalCal  = new Map<string, 'Closed' | 'Open'>()
  for (const d of calendarDays) {
    const status: 'Closed' | 'Open' | null = d.dayType === 1 ? 'Closed' : d.dayType === 2 ? 'Open' : null
    if (!status) continue
    if (d.shipmentMethodCode === method.code) specificCal.set(d.date, status)
    else if (d.shipmentMethodCode === '')     generalCal.set(d.date, status)
  }

  // Ugedag-flags: JS getDay() → 0=søn,1=man,2=tir,3=ons,4=tor,5=fre,6=lør
  const delivers = [method.sun, method.mon, method.tue, method.wed, method.thu, method.fri, method.sat]

  const dates: Date[] = []
  const cursor = new Date(earliestDispatch)
  let limit = 400

  while (dates.length < count && limit-- > 0) {
    const delivery = new Date(cursor)
    delivery.setDate(cursor.getDate() + transit)
    const iso     = delivery.toISOString().split('T')[0]
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
