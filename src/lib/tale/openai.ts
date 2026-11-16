// Tale til tekst og tekst til tale via OpenAI. Nøglen læses fra OPENAI_API_KEY i
// miljøet (.env.local på serveren) — aldrig i koden, og ALDRIG i browseren: lyden
// sendes til vores egen server, som er den eneste der kender nøglen.
//
// Hvorfor ikke browserens egne:
//   - Genkendelsen skrev "10 kW" og sprang varenavnene over (Claus 16-11). Her kan vi
//     give modellen vores varenavne med, og det er netop den slags ord den fejler på.
//   - Oplæsningen afhænger af, om telefonen har en dansk talepakke. Claus' Samsung
//     havde ingen, og kundernes telefoner er der ingen der styrer. Lyd fra serveren
//     lyder ens hos alle.

import { taleNoegleord, taleOrdbog } from './ordbog'

const TRANSSKRIBER_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-transcribe'
const TALE_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts'
const TALE_STEMME = process.env.OPENAI_TTS_VOICE || 'alloy'

export function taleKonfigureret(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}

function noegle(): string {
  const k = process.env.OPENAI_API_KEY
  if (!k) throw new Error('OPENAI_API_KEY mangler')
  return k
}

/**
 * Lyd → tekst. `egneOrd` er varenavne der er relevante lige nu; de kommer med som
 * ordbog, så modellen staver dem som vi gør.
 *
 * Fejl kastes med serverens egen tekst, så fejlsøgning ikke kræver gætteri — men
 * kalderen skal selv sørge for, at kunden får noget brugbart at se.
 */
export async function transskriber(
  lyd: Blob,
  filnavn: string,
  egneOrd: string[] = [],
  sprog = 'da',
): Promise<string> {
  const form = new FormData()
  form.append('file', lyd, filnavn)
  form.append('model', TRANSSKRIBER_MODEL)
  form.append('language', sprog)
  form.append('prompt', taleOrdbog(egneOrd))
  // De nyere modeller tager produktnavne i et felt for sig. Ukendte felter ignoreres
  // af API'et, og whisper-1 nøjes med prompten ovenfor.
  for (const ord of taleNoegleord(egneOrd)) form.append('keywords[]', ord)

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${noegle()}` },
    body: form,
    cache: 'no-store',
  })
  const tekst = await res.text()
  if (!res.ok) throw new Error(`transskribering fejlede (${res.status}): ${tekst.slice(0, 300)}`)
  try {
    const data = JSON.parse(tekst)
    return String(data?.text ?? '').trim()
  } catch {
    return tekst.trim()
  }
}

/** Tekst → lyd (mp3). Bruges når telefonen ikke selv kan læse op. */
export async function oplaesTale(tekst: string, sprog = 'da'): Promise<ArrayBuffer> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${noegle()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TALE_MODEL,
      voice: TALE_STEMME,
      input: tekst,
      // Stemmen skal lyde som en kollega i telefonen, ikke som en oplæser.
      instructions: sprog === 'da'
        ? 'Tal dansk, roligt og tydeligt, i et almindeligt samtaletempo.'
        : 'Speak calmly and clearly, at a normal conversational pace.',
      response_format: 'mp3',
    }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const fejl = await res.text()
    throw new Error(`oplæsning fejlede (${res.status}): ${fejl.slice(0, 300)}`)
  }
  return res.arrayBuffer()
}
