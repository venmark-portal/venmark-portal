import { defineDict } from '../lang'

// Menu (desktop-topbar, mobil-bundbjælke og "Mere"-arket).
export const navDict = defineDict({
  da: {
    oversigt: 'Oversigt', hjem: 'Hjem', bestil: 'Bestil', ordrer: 'Ordrer', fakturaer: 'Fakturaer',
    beskeder: 'Beskeder', auktioner: 'Auktioner', reklamationer: 'Reklamationer', profil: 'Profil',
    hjaelp: 'Support og vejledning', logUd: 'Log ud', mere: 'Mere', luk: 'Luk', kunden: 'kunden',
  },
  en: {
    oversigt: 'Overview', hjem: 'Home', bestil: 'Order', ordrer: 'Orders', fakturaer: 'Invoices',
    beskeder: 'Messages', auktioner: 'Auctions', reklamationer: 'Complaints', profil: 'Profile',
    hjaelp: 'Support and guides', logUd: 'Log out', mere: 'More', luk: 'Close', kunden: 'the customer',
  },
  de: {
    oversigt: 'Übersicht', hjem: 'Start', bestil: 'Bestellen', ordrer: 'Bestellungen', fakturaer: 'Rechnungen',
    beskeder: 'Nachrichten', auktioner: 'Auktionen', reklamationer: 'Reklamationen', profil: 'Profil',
    hjaelp: 'Support und Anleitung', logUd: 'Abmelden', mere: 'Mehr', luk: 'Schließen', kunden: 'den Kunden',
  },
})
