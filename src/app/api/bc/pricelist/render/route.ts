/**
 * POST /api/bc/pricelist/render
 *
 * Modtager prislistedata fra Business Central (codeunit 50311 "Portal Price List Mgt"),
 * renderer HTML via template.ts og producerer PDF via Puppeteer.
 * Returnerer PDF binary som application/pdf.
 *
 * Auth: samme x-webhook-secret som /api/bc/sync-customer.
 *
 * Body: se src/lib/pricelist/types.ts (PriceListData)
 *
 * Response: PDF bytes med Content-Disposition header
 *
 * Test lokalt:
 *   curl -X POST http://localhost:3000/api/bc/pricelist/render \
 *     -H "x-webhook-secret: $BC_WEBHOOK_SECRET" \
 *     -H "Content-Type: application/json" \
 *     --data @prisliste-9999FHSJAE-ENU-20260411.json \
 *     --output test.pdf
 */

import { NextRequest, NextResponse } from "next/server";
import { renderPriceListHtml } from "@/lib/pricelist/template";
import { renderPdfFromHtml } from "@/lib/pricelist/render";
import type { PriceListData } from "@/lib/pricelist/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function authOk(req: NextRequest): boolean {
  const secret = req.headers.get("x-webhook-secret");
  return Boolean(secret && secret === process.env.BC_WEBHOOK_SECRET);
}

function validateBody(body: unknown): body is PriceListData {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (!b.meta || typeof b.meta !== "object") return false;
  if (!Array.isArray(b.sections)) return false;
  const meta = b.meta as Record<string, unknown>;
  if (typeof meta.priceGroup !== "string") return false;
  if (typeof meta.language !== "string") return false;
  return true;
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "Uautoriseret" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON" }, { status: 400 });
  }

  if (!validateBody(body)) {
    return NextResponse.json(
      { error: "Body matcher ikke PriceListData-kontrakten" },
      { status: 400 }
    );
  }

  try {
    const html = renderPriceListHtml(body);
    const pdf = await renderPdfFromHtml({ html });

    const filename = `prisliste-${body.meta.priceGroup}-${body.meta.language}-${body.meta.printDate}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pricelist/render] Fejl:", err);
    return NextResponse.json(
      { error: "PDF-rendering fejlede", detail: message },
      { status: 500 }
    );
  }
}
