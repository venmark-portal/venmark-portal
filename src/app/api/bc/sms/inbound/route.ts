/**
 * POST /api/bc/sms/inbound
 *
 * Modtager indkomne SMS fra GatewayAPI's webhook (callback URL).
 * Validerer x-webhook-secret (samme mønster som sync-customer/pricelist),
 * normaliserer payload og forwarder til BC's "VM SMS Inbound API"
 * (page 50398, entity smsInbound) under venmark/portal/v1.0.
 *
 * GatewayAPI sender JSON som:
 *   {
 *     "id": 12345678,             // unik per modtaget SMS — bruges til idempotens
 *     "msisdn": 4541969644,       // afsender, internationalt format uden +
 *     "message": "tekst",
 *     "senttime": 1717419600,     // unix epoch sekunder
 *     "sender": "...",            // afsenderens navn (sjældent udfyldt)
 *     "webhook_label": ""
 *   }
 *
 * Auth: GatewayAPI's callback-konfig skal sætte enten
 *   1) Custom header: x-webhook-secret: <BC_WEBHOOK_SECRET>
 *   2) Query string:  ?secret=<BC_WEBHOOK_SECRET>
 * Vi accepterer begge for fleksibilitet.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/businesscentral";

export const runtime = "nodejs";

function authOk(req: NextRequest): boolean {
  const headerSecret =
    req.headers.get("x-webhook-secret") ?? req.headers.get("x-api-key");
  const querySecret = new URL(req.url).searchParams.get("secret");
  const provided = headerSecret ?? querySecret;
  const valid =
    process.env.BC_WEBHOOK_SECRET ?? process.env.BC_PORTAL_API_KEY;
  return Boolean(provided && valid && provided === valid);
}

interface GatewayApiInbound {
  id: number | string;
  msisdn: number | string;
  message?: string;
  senttime?: number | string;
  sender?: string;
}

function isInboundPayload(body: unknown): body is GatewayApiInbound {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    (typeof b.id === "number" || typeof b.id === "string") &&
    (typeof b.msisdn === "number" || typeof b.msisdn === "string")
  );
}

function unixToIso(senttime: number | string | undefined): string {
  if (senttime === undefined) return new Date().toISOString();
  const secs = typeof senttime === "string" ? Number(senttime) : senttime;
  if (!Number.isFinite(secs)) return new Date().toISOString();
  return new Date(secs * 1000).toISOString();
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

  if (!isInboundPayload(body)) {
    return NextResponse.json(
      { error: "Body mangler påkrævede felter (id, msisdn)" },
      { status: 400 }
    );
  }

  const tenantId = process.env.BC_TENANT_ID;
  const envName = process.env.BC_ENVIRONMENT_NAME ?? "production";
  const companyId = process.env.BC_COMPANY_ID;
  if (!tenantId || !companyId) {
    return NextResponse.json(
      { error: "BC-credentials ikke konfigureret på serveren" },
      { status: 500 }
    );
  }

  const bcPayload = {
    phone: String(body.msisdn),
    body: body.message ?? "",
    externalMessageId: String(body.id),
    receivedAt: unixToIso(body.senttime),
  };

  try {
    const token = await getAccessToken();
    const url =
      `https://api.businesscentral.dynamics.com/v2.0` +
      `/${tenantId}/${envName}/api/venmark/portal/v1.0` +
      `/companies(${companyId})/smsInbound`;

    const bcResp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(bcPayload),
      cache: "no-store",
    });

    if (!bcResp.ok) {
      const errText = await bcResp.text();
      console.error("[sms/inbound] BC svar:", bcResp.status, errText);
      return NextResponse.json(
        { error: "BC afviste posten", status: bcResp.status, detail: errText.slice(0, 500) },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sms/inbound] Fejl:", err);
    return NextResponse.json(
      { error: "Intern fejl ved videresendelse til BC", detail: message },
      { status: 500 }
    );
  }
}
