import { defineDict } from '../lang'

// Fælles tekster: API-fejl og de små komponenter i portal-layoutet
// (butiksvælger, som-kunde-bånd, push-knap, svar-toast, ny-version-bjælke).
export const faellesDict = defineDict({
  da: {
    ikkeLoggetInd: 'Ikke logget ind',
    fejlProevIgen: 'Fejl — prøv igen',
    fejl: 'Fejl',
    // CustomerSwitcher
    bestillerFor: 'Bestiller for:',
    migSelv: '(mig selv)',
    skifter: 'Skifter…',
    valgtButikInfo: 'Priser, levering og historik vises for den valgte butik.',
    // SomKundeBaand
    duSerSom: 'Du ser portalen som',
    aabnetAf: 'åbnet af {admin}',
    afslut: 'Afslut',
    // PushSubscribeButton
    pushFra: 'Slå push-notifikationer fra',
    pushAktiveret: 'Notifikationer aktiveret — klik for at slå fra',
    pushTil: 'Aktivér push-notifikationer',
    // TicketNotifier
    nyBesked: '💬 Ny besked på din reklamation',
    // VersionVagt
    nyUdgave: 'Der er kommet en ny udgave af portalen.',
    opdater: 'Opdater',
  },
  en: {
    ikkeLoggetInd: 'Not logged in',
    fejlProevIgen: 'Error — please try again',
    fejl: 'Error',
    bestillerFor: 'Ordering for:',
    migSelv: '(myself)',
    skifter: 'Switching…',
    valgtButikInfo: 'Prices, delivery and history are shown for the selected shop.',
    duSerSom: 'You are viewing the portal as',
    aabnetAf: 'opened by {admin}',
    afslut: 'Exit',
    pushFra: 'Turn off push notifications',
    pushAktiveret: 'Notifications on — click to turn off',
    pushTil: 'Turn on push notifications',
    nyBesked: '💬 New message on your complaint',
    nyUdgave: 'A new version of the portal is available.',
    opdater: 'Update',
  },
  de: {
    ikkeLoggetInd: 'Nicht angemeldet',
    fejlProevIgen: 'Fehler — bitte erneut versuchen',
    fejl: 'Fehler',
    bestillerFor: 'Bestellung für:',
    migSelv: '(ich selbst)',
    skifter: 'Wechsel…',
    valgtButikInfo: 'Preise, Lieferung und Verlauf gelten für den gewählten Shop.',
    duSerSom: 'Sie sehen das Portal als',
    aabnetAf: 'geöffnet von {admin}',
    afslut: 'Beenden',
    pushFra: 'Push-Benachrichtigungen ausschalten',
    pushAktiveret: 'Benachrichtigungen aktiv — klicken zum Ausschalten',
    pushTil: 'Push-Benachrichtigungen aktivieren',
    nyBesked: '💬 Neue Nachricht zu Ihrer Reklamation',
    nyUdgave: 'Eine neue Version des Portals ist verfügbar.',
    opdater: 'Aktualisieren',
  },
})
