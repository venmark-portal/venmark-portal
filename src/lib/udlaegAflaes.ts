// Forudfylder bilagsformularen ud fra kvitteringsbilledet. Medarbejderen ser og retter alt
// før afsendelse, så et forkert gæt koster kun en rettelse — aldrig en forkert postering.

import Anthropic from '@anthropic-ai/sdk'
import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages'

const MODEL = process.env.BILAG_MODEL || process.env.ROBOT_MODEL || 'claude-opus-5-5'

export interface Aflaesning {
  dato: string | null        // yyyy-mm-dd
  butik: string | null
  cvr: string | null
  beloeb: number | null      // inkl. moms
  moms: number | null
  valuta: string | null      // DKK, EUR, ...
  type: string | null        // benzin, restaurant, parkering, hotel, ...
}

const TOM: Aflaesning = { dato: null, butik: null, cvr: null, beloeb: null, moms: null, valuta: null, type: null }

let klient: Anthropic | null = null

export function aflaesningKonfigureret(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/** billeder = data-URL'er (image/jpeg|png|webp). */
export async function aflaesKvittering(billeder: string[]): Promise<Aflaesning> {
  if (!aflaesningKonfigureret() || billeder.length === 0) return TOM
  if (!klient) klient = new Anthropic()

  const blokke: ImageBlockParam[] = []
  for (const url of billeder.slice(0, 4)) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(url)
    if (m) blokke.push({ type: 'image', source: { type: 'base64', media_type: m[1] as 'image/jpeg', data: m[2] } })
  }
  if (blokke.length === 0) return TOM

  const svar = await klient.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        ...blokke,
        {
          type: 'text',
          text:
            'Billedet er en kvittering (evt. flere billeder af samme kvittering). Aflæs og svar KUN med ét JSON-objekt:\n' +
            '{"dato":"yyyy-mm-dd","butik":"butikkens navn","cvr":"CVR/momsnr. hvis det står der","beloeb":total inkl. moms som tal,' +
            '"moms":momsbeløb som tal,"valuta":"DKK","type":"et ord: benzin, restaurant, parkering, hotel, togbillet, taxa, kontorartikler, værktøj, andet"}\n' +
            'Brug null for felter du ikke kan læse sikkert. Danske beløb bruger komma som decimaltegn — returnér tal med punktum.',
        },
      ],
    }],
  })

  const tekst = svar.content.map(b => (b.type === 'text' ? b.text : '')).join('')
  const json = /\{[\s\S]*\}/.exec(tekst)?.[0]
  if (!json) return TOM
  try {
    const r = JSON.parse(json)
    const tal = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null)
    const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const dato = txt(r.dato)
    return {
      dato: dato && /^\d{4}-\d{2}-\d{2}$/.test(dato) ? dato : null,
      butik: txt(r.butik),
      cvr: txt(r.cvr),
      beloeb: tal(r.beloeb),
      moms: tal(r.moms),
      valuta: txt(r.valuta)?.toUpperCase().slice(0, 3) ?? null,
      type: txt(r.type),
    }
  } catch {
    return TOM
  }
}
