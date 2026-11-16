// Samtale-løkken: send historik + nyt spørgsmål til Claude, kør de værktøjer den beder om,
// og send svaret tilbage i bidder efterhånden som det skrives (streaming).

import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, ToolResultBlockParam, Tool } from '@anthropic-ai/sdk/resources/messages'
import { VAERKTOEJER, koerVaerktoej } from './vaerktoejer'
import { systemPrompt } from './prompt'
import type { RobotKontekst } from './kontekst'
import type { RobotTur } from './db'

// Opus 5.5 på lav indsats: bedst til at bruge værktøjerne rigtigt, stadig hurtig og billig
// pr. spørgsmål. Kan skiftes uden kodeændring med ROBOT_MODEL i .env.local.
const MODEL = process.env.ROBOT_MODEL || 'claude-opus-5-5'
const MAX_RUNDER = 6

let klient: Anthropic | null = null
function anthropic(): Anthropic {
  // Nøglen læses fra ANTHROPIC_API_KEY i miljøet (.env.local på serveren) — aldrig i koden.
  if (!klient) klient = new Anthropic()
  return klient
}

export function robotKonfigureret(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export interface MotorHaendelser {
  tekst: (bid: string) => void
  vaerktoej: (navn: string) => void
  /** Tekst skrevet i en runde der endte med et opslag, skal væk igen (se nedenfor). */
  ryd: () => void
}

export interface MotorResultat {
  svar: string
  vaerktoejer: string[]
  inputTokens: number
  outputTokens: number
  cacheTokens: number
}

// Sidste værktøj bærer cache-mærket → hele værktøjslisten caches sammen med instruksen.
const TOOLS: Tool[] = VAERKTOEJER.map((t, i) =>
  i === VAERKTOEJER.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t)

export async function koerSamtale(
  historik: RobotTur[],
  spoergsmaal: string,
  ctx: RobotKontekst,
  on: MotorHaendelser,
  /** Kunden talte spørgsmålet ind og får svaret læst op → kortere svar, ingen varenumre. */
  stemme = false,
): Promise<MotorResultat> {
  const messages: MessageParam[] = historik.map(t => ({
    role: t.rolle === 'kunde' ? 'user' : 'assistant',
    content: t.tekst,
  }))
  messages.push({ role: 'user', content: spoergsmaal })

  const system = await systemPrompt(ctx.kunde, { kurv: await ctx.kurvTekst(), stemme })
  const brugte: string[] = []
  let svar = ''
  let inputTokens = 0, outputTokens = 0, cacheTokens = 0

  for (let runde = 0; runde < MAX_RUNDER; runde++) {
    const stream = anthropic().messages.stream({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      system,
      tools: TOOLS,
      messages,
    } as any)
    let rundeTekst = ''
    stream.on('text', (bid: string) => { rundeTekst += bid; on.tekst(bid) })
    const msg = await stream.finalMessage()

    inputTokens  += msg.usage.input_tokens + (msg.usage.cache_creation_input_tokens ?? 0)
    cacheTokens  += msg.usage.cache_read_input_tokens ?? 0
    outputTokens += msg.usage.output_tokens

    // Assistent-turen sendes uændret tilbage (inkl. tænke-blokke) — kræves ved værktøjskald.
    messages.push({ role: 'assistant', content: msg.content as any })
    if (msg.stop_reason !== 'tool_use') { svar = rundeTekst; break }

    // Tekst før et opslag er robottens arbejdsnoter ("Check Friday availability …" — første
    // test 15-11 var endda på engelsk). Den vises kun, mens den skrives, og fjernes så igen;
    // kunden og loggen får kun det endelige svar.
    if (rundeTekst) on.ryd()

    const resultater: ToolResultBlockParam[] = []
    for (const blok of msg.content) {
      if (blok.type !== 'tool_use') continue
      // Navn + input i loggen, så vi kan se hvad robotten søgte på (fx "laks bakka").
      brugte.push(`${blok.name}${JSON.stringify(blok.input ?? {}).slice(0, 120)}`)
      on.vaerktoej(blok.name)
      let indhold: string
      try {
        const r: any = await koerVaerktoej(blok.name, blok.input, ctx)
        // Søgning uden træf markeres — admin viser dem som "det kunderne ikke kunne finde".
        if (Array.isArray(r?.varer) && r.varer.length === 0) brugte[brugte.length - 1] += '→0'
        indhold = JSON.stringify(r)
      } catch (err) {
        console.error(`[robot] værktøj ${blok.name} fejlede`, err)
        indhold = JSON.stringify({ fejl: 'Opslaget fejlede lige nu. Sig det til kunden og tilbyd at sende spørgsmålet til kontoret.' })
      }
      resultater.push({ type: 'tool_result', tool_use_id: blok.id, content: indhold })
    }
    messages.push({ role: 'user', content: resultater })
  }

  return { svar: svar.trim(), vaerktoejer: brugte, inputTokens, outputTokens, cacheTokens }
}
