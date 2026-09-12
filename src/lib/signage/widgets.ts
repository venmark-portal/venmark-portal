// Katalog over BC-widgets til info-skærme.
//
// KERNEREGEL: widgets er KODE-defineret. En redaktør kan placere en widget og
// sætte dens parametre — men aldrig ændre forespørgslen. Det er garantien for
// at BC-tallene på skærmene altid er korrekte og ens. Vil man have en ny
// widget, tilføjes den her (og en visning i src/components/skaerm/WidgetView).

import { getSalgsliste, getSalesOrdersForDelivery } from '@/lib/businesscentral'
import { produktionNu, sidsteUdbytter, type ProduktionNu, type UdbytteRaekke } from '@/lib/produktion'
import {
  afvisteLinjer, beskedFeed, nyesteReklamationer, tabteKunder,
  type AfvistLinje, type BeskedFeed, type Reklamation, type TabtKunde,
} from '@/lib/kontor'
import { pakkeriStatus, type PakkeriStatus } from '@/lib/pakkeri'
import { saelgerStat, type SaelgerStat } from '@/lib/saelgere'

export interface WidgetParamDef {
  key:     string
  label:   string
  type:    'number'
  default: number
  min:     number
  max:     number
}

export interface WidgetDef {
  id:          string
  name:        string
  description: string
  /** Hvor længe et svar må genbruges på tværs af alle skærme. */
  ttlSec:      number
  params:      WidgetParamDef[]
  fetch:       (params: Record<string, number>) => Promise<unknown>
}

function todayCopenhagen(): string {
  // en-CA giver YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date())
}

// ─── Widget-datatyper (deles med visningskomponenterne) ──────────────────────

export interface DagensSalgData {
  dato:  string
  raekker: { itemNo: string; description: string; uom: string; salg: number }[]
}

export interface LeveringerIDagData {
  dato:        string
  antalOrdrer: number
  totalKg:     number
  koder:       { code: string; antal: number; kg: number }[]
}

// ─── Kataloget ───────────────────────────────────────────────────────────────

const DEFS: WidgetDef[] = [
  {
    id:          'dagens-salg',
    name:        'Dagens salg',
    description: 'Mest solgte varer på dagens afsendelsesdato — antal pr. vare og enhed.',
    ttlSec:      60,
    params: [
      { key: 'top', label: 'Antal varer der vises', type: 'number', default: 8, min: 3, max: 20 },
    ],
    async fetch(params): Promise<DagensSalgData> {
      const dato = todayCopenhagen()
      // throwOnError: en skærm skal falde tilbage på sidste gode data når BC svarer
      // dårligt — ikke vise "intet salg i dag" som om det var et rigtigt tal.
      const rows = await getSalgsliste(dato, { throwOnError: true })
      const top  = params.top ?? 8
      const raekker = rows
        .filter(r => r.salg > 0)
        .sort((a, b) => b.salg - a.salg)
        .slice(0, top)
        .map(r => ({ itemNo: r.itemNo, description: r.description, uom: r.uom, salg: r.salg }))
      return { dato, raekker }
    },
  },
  {
    id:          'leveringer-i-dag',
    name:        'Leveringer i dag',
    description: 'Antal ordrer og kilo der skal ud i dag, fordelt på leveringsform.',
    // getSalesOrdersForDelivery henter ALLE ordrer og filtrerer i JS — dyrt kald,
    // så det skal have en lang TTL selv når 20 skærme viser det.
    ttlSec:      300,
    params: [
      { key: 'topKoder', label: 'Antal leveringsformer der vises', type: 'number', default: 6, min: 3, max: 12 },
    ],
    async fetch(params): Promise<LeveringerIDagData> {
      const dato   = todayCopenhagen()
      const orders = await getSalesOrdersForDelivery(dato)

      const perKode = new Map<string, { antal: number; kg: number }>()
      let totalKg = 0
      for (const o of orders) {
        const kg = o.totalWeightKg ?? 0
        totalKg += kg
        const koder = o.deliveryCodes?.length ? o.deliveryCodes : ['INGEN']
        // En ordre kan bære flere leveringskoder — vægten tælles på den første,
        // så totalen på tværs af koder stemmer med totalKg.
        koder.forEach((code, i) => {
          const e = perKode.get(code) ?? { antal: 0, kg: 0 }
          e.antal += 1
          if (i === 0) e.kg += kg
          perKode.set(code, e)
        })
      }

      const koder = Array.from(perKode, ([code, v]) => ({ code, ...v }))
        .sort((a, b) => b.antal - a.antal)
        .slice(0, params.topKoder ?? 6)

      return { dato, antalOrdrer: orders.length, totalKg, koder }
    },
  },
]

DEFS.push(
  {
    id:          'udbytte-montager',
    name:        'Udbytter, sidste lukkede montager',
    description: 'Én række pr. montage: hovedvarens udbytte, biprodukter samlet, og i alt. Viser kun varenumre 10000-25000 og montager med mindst 25 kg råvare — resten er fejl eller produktioner hvor systemet er "snydt".',
    ttlSec:      300,
    params: [
      { key: 'antal', label: 'Antal montager', type: 'number', default: 12, min: 3, max: 25 },
    ],
    async fetch(params): Promise<UdbytteRaekke[]> {
      return sidsteUdbytter(params.antal ?? 12)
    },
  },
  {
    id:          'produktion-nu',
    name:        'Produktion nu',
    description: 'Produktionslinjerne med dagens produktioner under hver, og initialerne på dem der er stemplet ind på linjen. Afsluttede produktioner fra i dag bærer deres egne initialer. Viser kun varenumre 10000-25000 — røgeri (over 40000) færdiggøres først dagen efter.',
    ttlSec:      60,
    params: [
      { key: 'topLinjer', label: 'Antal linjer', type: 'number', default: 6, min: 3, max: 12 },
    ],
    async fetch(params): Promise<ProduktionNu> {
      const d = await produktionNu()
      return { ...d, linjer: d.linjer.slice(0, params.topLinjer ?? 6) }
    },
  },
)

DEFS.push(
  {
    id:          'beskeder',
    name:        'Beskeder (mail · SMS · portal)',
    description: 'Mail, indgående SMS og beskeder fra kundeportalen blandet sammen efter tid — kun overskrifter, med farve pr. type.',
    ttlSec:      60,
    params: [
      { key: 'antal', label: 'Antal beskeder', type: 'number', default: 20, min: 5, max: 40 },
    ],
    async fetch(params): Promise<BeskedFeed> { return beskedFeed(params.antal ?? 20) },
  },
  {
    id:          'afvist-linjer',
    name:        'Afviste varer (oversalg)',
    description: 'Salgslinjer hvor sælgeren har solgt mere end der var — nyeste først, med sælgernavn.',
    ttlSec:      120,
    params: [
      { key: 'antal', label: 'Antal linjer', type: 'number', default: 15, min: 5, max: 30 },
    ],
    async fetch(params): Promise<AfvistLinje[]> { return afvisteLinjer(params.antal ?? 15) },
  },
  {
    id:          'reklamationer',
    name:        'Nyeste reklamationer',
    description: 'De senest oprettede reklamationer fra kundeportalen.',
    ttlSec:      120,
    params: [
      { key: 'antal', label: 'Antal', type: 'number', default: 3, min: 1, max: 10 },
    ],
    async fetch(params): Promise<Reklamation[]> { return nyesteReklamationer(params.antal ?? 3) },
  },
  {
    id:          'tabte-kunder',
    name:        'Kunder vi er ved at tabe',
    description: 'Kunder hvis seneste faktura ligger mellem 7 og 21 dage tilbage — længst væk først. Det er der de tabes.',
    ttlSec:      600,
    params: [
      { key: 'fra',   label: 'Fra dage',  type: 'number', default: 7,  min: 1,  max: 60 },
      { key: 'til',   label: 'Til dage',  type: 'number', default: 21, min: 2,  max: 120 },
      // Loftet var 10, men der er ~85 kunder i intervallet. Skærmen viste derfor
      // kun de ældste (17-21 dage) og aldrig dem på 8-16 dage, hvor man stadig
      // kan nå at redde handlen. Listen ruller, så alle skal med.
      { key: 'antal', label: 'Maks antal', type: 'number', default: 300, min: 3, max: 500 },
    ],
    async fetch(params): Promise<TabtKunde[]> {
      return tabteKunder(params.fra ?? 7, params.til ?? 21, params.antal ?? 300)
    },
  },
  {
    id:          'pakkeri-status',
    name:        'Pakkeristatus',
    description: 'Dagens ordrer og linjer — hvor mange der mangler pakker, og pr. pakker hvor mange linjer der er pakket og hvor mange af dem der er scannet.',
    ttlSec:      60,
    params: [],
    async fetch(): Promise<PakkeriStatus> {
      return pakkeriStatus(todayCopenhagen())
    },
  },
  {
    id:          'saelger-linjer',
    name:        'Sælgere i dag',
    description: 'Antal salgslinjer hver sælger har lagt ind i dag, og hvor stor en del der kom via hurtig indtastning.',
    ttlSec:      120,
    params: [],
    async fetch(): Promise<SaelgerStat> { return saelgerStat() },
  },
)

export const WIDGETS: Record<string, WidgetDef> = Object.fromEntries(DEFS.map(w => [w.id, w]))

export function listWidgets(): WidgetDef[] {
  return DEFS
}

export function getWidget(id: string): WidgetDef | null {
  return WIDGETS[id] ?? null
}

/** Kataloget uden fetch-funktionerne — til admin-UI'et. */
export function widgetCatalog() {
  return DEFS.map(({ id, name, description, ttlSec, params }) => ({ id, name, description, ttlSec, params }))
}
