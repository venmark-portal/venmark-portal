// KBH-levering: efter en portalbestilling er lagt i BC, flytter BC (cu 50476) de varer der er
// disponible på lageret i København over på kundens XVEN-ordre — samme leveringsdag, pakkes og
// køres fra København. Kunden får det at vide på kvitteringen; delte linjer (KBH havde kun en
// del) giver desuden en besked til Venmark, så nogen tjekker op.
//
// Fejl-politik: opsplitningen er en optimering. Fejler BC-kaldet, er INTET ændret (én transaktion
// i BC) og hele bestillingen leveres fra Hirtshals — det logges, men bestillingen afvises ikke.
import { prisma } from '@/lib/prisma'
import { splitKbhOrder, flagBeskedUlaest } from '@/lib/businesscentral'

export interface KbhKvittering {
  xvenOrdre:    string
  levering:     string    // YYYY-MM-DD
  hovedSlettet: boolean   // ALT kom fra København → Hirtshals-ordren findes ikke længere
  flyttet: { itemNo: string; navn: string; antal: number; enhed: string }[]
  delt:    { itemNo: string; navn: string; bestilt: number; kbh: number; hirtshals: number; enhed: string }[]
}

const tal = (n: number) => n.toLocaleString('da-DK', { maximumFractionDigits: 2 })

export async function kbhOpsplit(opts: {
  ordreNr:      string
  sletTomHoved: boolean                 // kun en NY portalordre må slettes, hvis alt kom fra KBH
  navne:        Map<string, string>     // varenr → dansk navn (til Venmarks besked)
  portalKunde?: { id: string; name: string; bcCustomerNumber: string | null }
  kundeNr:      string                  // den butik der er bestilt til (til log + besked)
}): Promise<KbhKvittering | null> {
  let r
  try {
    r = await splitKbhOrder(opts.ordreNr, opts.sletTomHoved)
  } catch (e) {
    console.error(`[kbh] opsplitning fejlede for ${opts.kundeNr} ordre ${opts.ordreNr} — alt leveres fra Hirtshals:`,
      e instanceof Error ? e.message : e)
    return null
  }
  if (r.errorText) console.error(`[kbh] ${opts.kundeNr} ordre ${opts.ordreNr}: ${r.errorText}`)
  if (!r.xvenOrderNo || r.movedLines === 0) return null

  const navn = (nr: string) => opts.navne.get(nr) || nr
  const kv: KbhKvittering = {
    xvenOrdre:    r.xvenOrderNo,
    levering:     r.deliveryDate,
    hovedSlettet: r.mainOrderDeleted,
    flyttet: r.moved.map(m => ({ itemNo: m.itemNo, navn: navn(m.itemNo), antal: m.qty, enhed: m.uom })),
    delt:    r.partial.map(p => ({
      itemNo: p.itemNo, navn: navn(p.itemNo), bestilt: p.kbhQty + p.restQty, kbh: p.kbhQty, hirtshals: p.restQty, enhed: p.uom,
    })),
  }
  console.log(`[kbh] ${opts.kundeNr} ordre ${opts.ordreNr} → XVEN ${r.xvenOrderNo}: ${r.movedLines} linje(r), ${r.partialLines} delt`)

  // Delte linjer → Venmark skal tjekke op (samme kanal som auktionens beskeder: en "kunde"-besked
  // med eget afsendernavn, ulæst for Venmark, så den lander på kontorskærmen/ringelisten).
  if (kv.delt.length && opts.portalKunde) {
    const linjer = kv.delt.map(d =>
      `• ${d.itemNo} ${d.navn}: bestilt ${tal(d.bestilt)} ${d.enhed} — ${tal(d.kbh)} fra KBH (ordre ${kv.xvenOrdre}), ${tal(d.hirtshals)} fra Hirtshals (ordre ${opts.ordreNr})`)
    const body = `KBH-levering ${opts.kundeNr}, levering ${kv.levering}: kun delvist på lager i København — tjek op.\n${linjer.join('\n')}`
    const udloeb = new Date(); udloeb.setDate(udloeb.getDate() + 30)
    try {
      await prisma.message.create({
        data: {
          customerId: opts.portalKunde.id, sender: 'customer', senderName: 'KBH-levering', body,
          readByAdmin: false, readByCustomer: true, expiresAt: udloeb,
        },
      })
      if (opts.portalKunde.bcCustomerNumber) flagBeskedUlaest(opts.portalKunde.bcCustomerNumber).catch(() => {})
    } catch (e) {
      console.error('[kbh] besked til Venmark fejlede:', e instanceof Error ? e.message : e)
    }
  }
  return kv
}
