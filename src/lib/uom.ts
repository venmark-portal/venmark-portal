type UomLike = { code: string; qtyPerUnitOfMeasure?: number; salesUnit?: boolean }

/**
 * Enheden når kunden ikke selv har valgt: varekortets Salgsenhed i BC, ellers basisenheden.
 * En salgsenhed med Antal pr. enhed = 1 springes over — den er ikke rettet i BC endnu
 * (fx "2KG/KS" = 1), og forvalgt ville 3 "kasser" blive bestilt som 3 kg.
 */
export function defaultUom(item: { baseUnitOfMeasureCode: string; uoms?: UomLike[] }): string {
  const s = item.uoms?.find(u => u.salesUnit)
  if (s && (s.code === item.baseUnitOfMeasureCode || (s.qtyPerUnitOfMeasure ?? 1) > 1)) return s.code
  return item.baseUnitOfMeasureCode
}
