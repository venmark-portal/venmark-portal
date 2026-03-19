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
