import { defineDict } from '../lang'

// Beskeder (chat med Venmark) — side + API.
export const beskederDict = defineDict({
  da: {
    titel: 'Beskeder',
    undertitel: 'Direkte kontakt med Venmark — beskeder gemmes i 30 dage',
    henter: 'Henter…',
    ingen1: 'Ingen beskeder endnu.', ingen2: 'Send en besked nedenfor.',
    placeholder: 'Skriv en besked… (Enter for at sende)',
    send: 'Send',
    ikkeLoggetInd: 'Ikke logget ind', tomBesked: 'Tom besked',
  },
  en: {
    titel: 'Messages',
    undertitel: 'Direct contact with Venmark — messages are kept for 30 days',
    henter: 'Loading…',
    ingen1: 'No messages yet.', ingen2: 'Send a message below.',
    placeholder: 'Write a message… (Enter to send)',
    send: 'Send',
    ikkeLoggetInd: 'Not logged in', tomBesked: 'Empty message',
  },
  de: {
    titel: 'Nachrichten',
    undertitel: 'Direkter Kontakt mit Venmark — Nachrichten werden 30 Tage gespeichert',
    henter: 'Wird geladen…',
    ingen1: 'Noch keine Nachrichten.', ingen2: 'Senden Sie unten eine Nachricht.',
    placeholder: 'Nachricht schreiben… (Enter zum Senden)',
    send: 'Senden',
    ikkeLoggetInd: 'Nicht angemeldet', tomBesked: 'Leere Nachricht',
  },
})
