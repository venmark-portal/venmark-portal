/**
 * Type-definitioner for prislistedata fra Business Central.
 *
 * BC's codeunit 50311 "Portal Price List Mgt" producerer JSON der matcher
 * disse typer. Bruges af HTML-template og PDF-renderer.
 */

export interface PriceListMeta {
  priceGroup: string;       // fx "9999FHSJÆ"
  language: string;         // fx "ENU", "DAN", "DEU"
  printDate: string;        // ISO 8601 dato
  title: string;            // Hoved-titel
  header: string;           // Øverste header-linje (Venmark Fisk - Hirtshals...)
  footer: string;           // Forbehold, leveringsgebyr osv.
}

export interface PriceTier {
  minQty: number;           // Minimum quantity for denne pris
  price: number;            // Pris pr. enhed
  uom: string;              // Unit of Measure (KG, STK osv.)
}

export interface PriceListItem {
  no: string;               // Varenr. (fx "10677")
  description: string;      // Oversat beskrivelse
  statusNote: string;       // Oversat statustekst (Frost, Udsolgt, etc.)
  unit: string;             // Basisenhed (KG, STK osv.)
  saelgForH: boolean;       // "Sælg for h......" flag
  tiers: PriceTier[];       // Trappepriser (sorteret efter minQty stigende)
}

export interface PriceListSection {
  header: string;           // Sektionsoverskrift ("Fladfisk", "Dagens tilbud" osv.)
  isOffer: boolean;         // Er dette "dagens tilbud"-sektionen?
  sequence: number;         // Rækkefølge på listen
  items: PriceListItem[];
}

export interface PriceListData {
  meta: PriceListMeta;
  sections: PriceListSection[];
}

/**
 * Max antal trappe-kolonner vi viser på prislisten.
 * Original Excel viste 5 (antal/pris × 5 kolonner).
 */
export const MAX_TIER_COLUMNS = 5;
