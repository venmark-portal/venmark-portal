/**
 * HTML-template til Venmark prisliste.
 *
 * Producerer en komplet HTML-side der matcher det originale Excel-layout
 * tæt: header med Venmark-branding, sektioner med varer, trappepriser
 * i op til 5 kolonner pr. række.
 *
 * Output sendes videre til Puppeteer/Chromium for PDF-rendering.
 */

import type { PriceListData, PriceListItem, PriceListSection } from "./types";
import { MAX_TIER_COLUMNS } from "./types";

/**
 * Escape HTML til sikker indsættelse. Simpelt nok - vi har fuld kontrol
 * over inputtet fra BC, men bedre safe than sorry.
 */
function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Formater pris som "45,00" (dansk/europæisk format med komma).
 */
function fmtPrice(n: number): string {
  if (n == null || Number.isNaN(n)) return "";
  return n.toFixed(2).replace(".", ",");
}

/**
 * Formater antal. Hvis det er et heltal vises det som "5", ellers "1,5".
 */
function fmtQty(n: number): string {
  if (n == null || Number.isNaN(n)) return "";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(".", ",");
}

/**
 * Formater dato (ISO string) til "10. april 2026".
 */
function fmtDate(iso: string, language: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const locales: Record<string, string> = {
    DAN: "da-DK",
    ENU: "en-GB",
    DEU: "de-DE",
    SVE: "sv-SE",
    NOR: "nb-NO",
    FRA: "fr-FR",
    ITA: "it-IT",
    ESP: "es-ES",
    NLD: "nl-NL",
  };
  const locale = locales[language] ?? "en-GB";
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Render én vare som <tr>.
 * Fem faste pris-kolonne-par (antal + pris). Tomme celler hvis varen har færre trin.
 */
function renderItemRow(item: PriceListItem): string {
  const tiers = item.tiers.slice(0, MAX_TIER_COLUMNS);
  const tierCells: string[] = [];

  for (let i = 0; i < MAX_TIER_COLUMNS; i++) {
    const tier = tiers[i];
    if (tier) {
      tierCells.push(
        `<td class="qty">${fmtQty(tier.minQty)}</td>` +
          `<td class="price">${fmtPrice(tier.price)}</td>`
      );
    } else {
      tierCells.push(`<td class="qty"></td><td class="price"></td>`);
    }
  }

  const statusCell = item.statusNote
    ? `<td class="status">${esc(item.statusNote)}</td>`
    : `<td class="status"></td>`;

  return `
    <tr>
      <td class="itemno">${esc(item.no)}</td>
      ${statusCell}
      <td class="description">${esc(item.description)}</td>
      <td class="unit">${esc(item.unit)}</td>
      ${tierCells.join("")}
    </tr>`;
}

/**
 * Render én sektion med header-række og alle vare-rækker.
 */
function renderSection(section: PriceListSection, language: string): string {
  if (section.items.length === 0) return "";

  const sectionClass = section.isOffer ? "section offer-section" : "section";

  const headers = getTableHeaders(language);

  const rows = section.items.map(renderItemRow).join("");

  return `
    <section class="${sectionClass}">
      <h2>${esc(section.header)}</h2>
      <table class="pricetable">
        <thead>
          <tr>
            <th class="itemno"></th>
            <th class="status"></th>
            <th class="description"></th>
            <th class="unit">${headers.unit}</th>
            <th class="qty">${headers.qty}</th>
            <th class="price">${headers.price}</th>
            <th class="qty">${headers.qty}</th>
            <th class="price">${headers.price}</th>
            <th class="qty">${headers.qty}</th>
            <th class="price">${headers.price}</th>
            <th class="qty">${headers.qty}</th>
            <th class="price">${headers.price}</th>
            <th class="qty">${headers.qty}</th>
            <th class="price">${headers.price}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

/**
 * Lokale kolonnehoveder pr. sprog. Udvides efter behov.
 */
function getTableHeaders(language: string): {
  unit: string;
  qty: string;
  price: string;
} {
  const map: Record<string, { unit: string; qty: string; price: string }> = {
    DAN: { unit: "Enhed", qty: "Antal", price: "Pris" },
    ENU: { unit: "Unit", qty: "Qty", price: "Price" },
    DEU: { unit: "Einheit", qty: "Menge", price: "Preis" },
    SVE: { unit: "Enhet", qty: "Antal", price: "Pris" },
    NOR: { unit: "Enhet", qty: "Antall", price: "Pris" },
    FRA: { unit: "Unité", qty: "Qté", price: "Prix" },
    ITA: { unit: "Unità", qty: "Qtà", price: "Prezzo" },
    ESP: { unit: "Unidad", qty: "Cant.", price: "Precio" },
    NLD: { unit: "Eenheid", qty: "Aantal", price: "Prijs" },
  };
  return map[language] ?? map.ENU;
}

/**
 * Producerer komplet HTML-dokument.
 */
export function renderPriceListHtml(data: PriceListData): string {
  const { meta, sections } = data;

  const sectionsHtml = sections
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => renderSection(s, meta.language))
    .join("\n");

  return `<!DOCTYPE html>
<html lang="${esc(meta.language.toLowerCase())}">
<head>
<meta charset="UTF-8">
<title>${esc(meta.title)} - ${esc(meta.priceGroup)}</title>
<style>
  @page {
    size: A4 landscape;
    margin: 10mm 10mm 12mm 10mm;
  }
  * { box-sizing: border-box; }
  html, body {
    font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
    font-size: 8pt;
    color: #111;
    margin: 0;
    padding: 0;
  }
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 4mm;
    margin-bottom: 3mm;
    border-bottom: 2px solid #e8a100;
  }
  .brand {
    font-size: 14pt;
    font-weight: bold;
    color: #003366;
  }
  .brand small {
    display: block;
    font-size: 9pt;
    font-weight: normal;
    color: #444;
    margin-top: 1mm;
  }
  .meta {
    text-align: right;
    font-size: 9pt;
  }
  .meta .date {
    font-weight: bold;
    font-size: 11pt;
    color: #b85c00;
  }
  .intro {
    background: #fff8d6;
    padding: 2mm 3mm;
    margin-bottom: 3mm;
    font-size: 8pt;
    border-left: 3px solid #e8a100;
  }
  h1.list-title {
    font-size: 16pt;
    color: #003366;
    margin: 0 0 3mm 0;
  }
  .section {
    margin-bottom: 4mm;
    page-break-inside: auto;
  }
  .section h2 {
    background: #003366;
    color: #fff;
    font-size: 10pt;
    padding: 1.5mm 3mm;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .offer-section h2 {
    background: #b85c00;
  }
  table.pricetable {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  table.pricetable th {
    font-size: 7pt;
    font-weight: normal;
    color: #666;
    text-align: right;
    background: #f5f5f5;
    padding: 1mm 1.5mm;
    border-bottom: 1px solid #ddd;
  }
  table.pricetable td {
    padding: 1mm 1.5mm;
    border-bottom: 1px solid #eee;
    font-size: 8pt;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  table.pricetable tbody tr:nth-child(even) {
    background: #fafafa;
  }
  td.itemno, th.itemno {
    width: 10mm;
    font-family: "Courier New", monospace;
    color: #555;
  }
  td.status, th.status {
    width: 22mm;
    font-style: italic;
    color: #b85c00;
  }
  td.description, th.description {
    width: 70mm;
  }
  td.unit, th.unit {
    width: 12mm;
    text-align: center;
    color: #666;
  }
  td.qty, th.qty {
    width: 8mm;
    text-align: right;
    color: #666;
  }
  td.price, th.price {
    width: 12mm;
    text-align: right;
    font-weight: bold;
  }
  .footer {
    margin-top: 5mm;
    padding-top: 2mm;
    border-top: 1px solid #ddd;
    font-size: 7pt;
    color: #666;
    text-align: center;
  }
</style>
</head>
<body>
  <header class="page-header">
    <div class="brand">
      Venmark Fisk A/S
      <small>Hirtshals • Tlf. 98 94 59 65 • www.venmark.dk</small>
    </div>
    <div class="meta">
      <div class="date">${fmtDate(meta.printDate, meta.language)}</div>
      <div>${esc(meta.priceGroup)}</div>
    </div>
  </header>

  <h1 class="list-title">${esc(meta.title)}</h1>

  <div class="intro">
    ${esc(meta.header)}
  </div>

  ${sectionsHtml}

  <footer class="footer">
    ${esc(meta.footer)}
  </footer>
</body>
</html>`;
}
