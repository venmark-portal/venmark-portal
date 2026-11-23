'use client'

// "TOM HYLDE? SCAN HER" — fra håndterminalen.
//
// Kanban-QR'en på hylde-labelen er en adresse, så den også kan scannes med et
// almindeligt telefonkamera. Men den, der står med terminalen og tæller op, skal
// ikke først finde sin telefon frem: scanner han kortet, kommer denne lille
// afbrydelse, og så er han videre (Claus 23-11).
//
// Beskeden er FRIVILLIG. Kravet er, at kontoret får det at vide med det samme —
// alt andet ville gøre meldingen til noget, man springer over, fordi man har
// travlt og ikke kan finde på noget at skrive.
//
// Dialogen er IKKE koblet på bestillingsskærmen. Dér fanger man alligevel, hvad
// der mangler, mens man fylder kurven, og en melding oven i ville være støj.

import { useState } from 'react'
import Bemaerkning from './Bemaerkning'

export interface MeldSvar {
  slags: 'ok' | 'fejl'
  tekst: string
}

export default function MeldTomHylde({
  itemNo,
  navn,
  onFaerdig,
}: {
  itemNo: string
  navn: string
  /** Lukket uden at melde giver `null`; ellers beskeden, skærmen skal vise. */
  onFaerdig: (svar: MeldSvar | null) => void
}) {
  const [sender, setSender] = useState(false)

  async function meld(note: string) {
    if (sender) return
    setSender(true)
    try {
      const r = await fetch('/api/kanban', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ itemNo, note }),
      })
      const v = await r.json().catch(() => null)
      if (!r.ok) {
        onFaerdig({ slags: 'fejl', tekst: v?.error ?? 'Meldingen kunne ikke sendes — prøv igen' })
        return
      }
      onFaerdig({
        slags: 'ok',
        tekst:
          (v?.antal ?? 1) > 1
            ? `${itemNo} meldt tom (${v.antal}. gang). Kontoret har fået besked.`
            : `${itemNo} meldt tom. Kontoret har fået besked.`,
      })
    } catch {
      // Ingen forbindelse ved hylden er en helt almindelig tilstand i et kølerum.
      onFaerdig({ slags: 'fejl', tekst: 'Ingen forbindelse — meldingen blev IKKE sendt' })
    } finally {
      setSender(false)
    }
  }

  return (
    <Bemaerkning
      vare={navn ? `${itemNo} · ${navn}` : itemNo}
      titel="Meld hylden tom"
      gemTekst={sender ? 'Sender …' : 'Meld tom — send til kontoret'}
      placeholder="Fx: sidste kasse taget, der står intet tilbage"
      info="Kontoret får en mail med det samme. Beskeden er frivillig — du kan også bare trykke Meld tom."
      onGem={meld}
      onLuk={() => onFaerdig(null)}
    />
  )
}
