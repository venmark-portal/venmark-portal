/**
 * POST /api/bc/pricelist/preview
 *
 * Samme som /api/bc/pricelist/render - men returnerer HTML direkte (text/html)
 * i stedet for at gå gennem Puppeteer. Formål: hurtig iteration på layoutet
 * i browser uden at vente på PDF-generering.
 *
 * Test:
 *   curl -X POST http://localhost:3000/api/bc/pricelist/preview \
 *     -H "x-webhook-secret: $BC_WEBHOOK_SECRET" \
 *     -H "Content-Type: application/json" \
 *     --data @prisliste-test.json > preview.html
 *   open preview.html
 */

import { NextRequest, NextResponse } from "next/server";
import { renderPriceListHtml } from "@/lib/pricelist/template";
import type { PriceListData } from "@/lib/pricelist/types";

export const runtime = "nodejs";

function authOk(req: NextRequest): boolean {
  const secret = req.headers.get("x-webhook-secret");
  return Boolean(secret && secret === process.env.BC_WEBHOOK_SECRET);
}

function validateBody(body: unknown): body is PriceListData {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (!b.meta || typeof b.meta !== "object") return false;
  if (!Array.isArray(b.sections)) return false;
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

  const html = renderPriceListHtml(body);
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
