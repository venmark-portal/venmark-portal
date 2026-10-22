import { defineDict } from '../lang'

// Kundesynlige fejlbeskeder fra bestil-sidens API-ruter (category-items, kurv).
export const bestilApiDict = defineDict({
  da: {
    ikkeLoggetInd: 'Ikke logget ind',
    categoryMangler: 'category mangler',
    ingenKunde: 'Ingen kunde',
    linjerMangler: 'linjer mangler',
  },
  en: {
    ikkeLoggetInd: 'Not logged in',
    categoryMangler: 'category is missing',
    ingenKunde: 'No customer',
    linjerMangler: 'lines are missing',
  },
  de: {
    ikkeLoggetInd: 'Nicht angemeldet',
    categoryMangler: 'category fehlt',
    ingenKunde: 'Kein Kunde',
    linjerMangler: 'Positionen fehlen',
  },
})
