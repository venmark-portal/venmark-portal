/**
 * POD — Proof of Delivery
 * Sender email og SMS via GatewayAPI når et stop markeres leveret med foto.
 *
 * TEST_MODE = true  → alt går til POD_TEST_EMAIL / POD_TEST_PHONE
 * TEST_MODE = false → brug de konfigurerede modtagere fra DB
 *
 * Env vars:
 *   GATEWAY_API_TOKEN  — GatewayAPI (til BÅDE email og SMS)
 *   APP_URL            — base-URL til foto-link (https://venmark.dk)
 *   POD_TEST_MODE      — "false" = live (default: true = test)
 *   POD_TEST_EMAIL     — claus@venmark.dk
 *   POD_TEST_PHONE     — 41969644
 */

const TEST_MODE  = process.env.POD_TEST_MODE  !== 'false'
const TEST_EMAIL = process.env.POD_TEST_EMAIL ?? 'claus@venmark.dk'
const TEST_PHONE = process.env.POD_TEST_PHONE ?? '41969644'
const APP_URL    = (process.env.APP_URL ?? 'http://204.168.191.215').replace(/\/$/, '')
const GW_TOKEN   = process.env.GATEWAY_API_TOKEN ?? ''

// ── Email via GatewayAPI ──────────────────────────────────────────────────────

async function sendEmail(to: string, customerName: string, photoUrl: string, deliveredAt: Date) {
  if (!GW_TOKEN) {
    console.log(`[POD] GATEWAY_API_TOKEN ikke sat — ville have sendt email til ${to}`)
    return
  }
  const tid = deliveredAt.toLocaleTimeString('da-DK', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Copenhagen',
  })
  const dato = deliveredAt.toLocaleDateString('da-DK', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Copenhagen',
  })

  const res = await fetch('https://gatewayapi.com/rest/email', {
    method:  'POST',
    headers: {
      'Authorization': `Token ${GW_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    { name: 'Venmark Fisk', email: 'ordre@venmark.dk' },
      subject: `Levering bekræftet — ${customerName}`,
      recipients: [{ address: to }],
      html: `
        <p>Kære kunde,</p>
        <p>Din levering fra <strong>Venmark Fisk</strong> er afleveret ${dato} kl. ${tid}.</p>
        <p>
          <a href="${photoUrl}"
             style="display:inline-block;background:#16a34a;color:#fff;padding:10px 20px;
                    border-radius:8px;text-decoration:none;font-weight:bold;">
            Se leveringsfoto
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px;">Linket er gyldigt i 30 dage.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
        <p style="color:#6b7280;font-size:12px;">Venmark Fisk A/S · venmark.dk</p>
      `,
    }),
  })

  if (!res.ok) {
    console.error(`[POD] Email fejl til ${to}: ${await res.text()}`)
  } else {
    console.log(`[POD] Email sendt til ${to}`)
  }
}

// ── SMS via GatewayAPI ────────────────────────────────────────────────────────

async function sendSms(phone: string, photoUrl: string) {
  if (!GW_TOKEN) {
    console.log(`[POD] GATEWAY_API_TOKEN ikke sat — ville have sendt SMS til ${phone}`)
    return
  }
  const normalized = phone.replace(/\s/g, '').replace(/^\+45/, '').replace(/^0045/, '')
  const msisdn = normalized.startsWith('45') ? normalized : `45${normalized}`

  const res = await fetch('https://gatewayapi.com/rest/mtsms', {
    method:  'POST',
    headers: {
      'Authorization': `Token ${GW_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      sender:     'Venmark',
      message:    `Venmark Fisk: Din levering er afleveret. Se foto: ${photoUrl}`,
      recipients: [{ msisdn }],
    }),
  })

  if (!res.ok) {
    console.error(`[POD] SMS fejl til ${msisdn}: ${await res.text()}`)
  } else {
    console.log(`[POD] SMS sendt til ${msisdn}`)
  }
}

// ── Offentlig funktion ────────────────────────────────────────────────────────

export interface PodRecipient {
  email:     string | null
  phone:     string | null
  sendEmail: boolean
  sendSms:   boolean
}

export async function sendPod(opts: {
  stopId:       string
  customerName: string
  deliveredAt:  Date
  recipients:   PodRecipient[]
}) {
  const photoUrl = `${APP_URL}/api/chauffeur/stop/${opts.stopId}/photo`

  const targets: PodRecipient[] = TEST_MODE
    ? [{ email: TEST_EMAIL, phone: TEST_PHONE, sendEmail: true, sendSms: true }]
    : opts.recipients.filter(r => r.sendEmail || r.sendSms)

  if (targets.length === 0) {
    console.log(`[POD] Ingen modtagere for ${opts.customerName}`)
    return
  }

  const label = TEST_MODE ? `[TEST → ${TEST_EMAIL} / ${TEST_PHONE}]` : `[${opts.customerName}]`
  console.log(`[POD] Sender til ${targets.length} modtager(e) ${label}`)

  await Promise.allSettled(
    targets.flatMap(r => [
      r.sendEmail && r.email ? sendEmail(r.email, opts.customerName, photoUrl, opts.deliveredAt) : null,
      r.sendSms   && r.phone ? sendSms(r.phone, photoUrl) : null,
    ].filter(Boolean) as Promise<void>[])
  )
}
