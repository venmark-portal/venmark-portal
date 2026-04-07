/**
 * POD — Proof of Delivery
 * Email via SMTP (nodemailer), SMS via GatewayAPI.
 *
 * TEST_MODE = true  → alt går til POD_TEST_EMAIL / POD_TEST_PHONE
 * TEST_MODE = false → brug de konfigurerede modtagere fra DB
 *
 * Env vars (email — samme som resten af systemet):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * Env vars (SMS):
 *   GATEWAY_API_TOKEN
 * Env vars (POD):
 *   APP_URL           — base-URL til foto-link
 *   POD_TEST_MODE     — "false" = live (default: true = test)
 *   POD_TEST_EMAIL    — claus@venmark.dk
 *   POD_TEST_PHONE    — 41969644
 */

import nodemailer from 'nodemailer'

const TEST_MODE  = process.env.POD_TEST_MODE  !== 'false'
const TEST_EMAIL = process.env.POD_TEST_EMAIL ?? 'claus@venmark.dk'
const TEST_PHONE = process.env.POD_TEST_PHONE ?? '41969644'
const APP_URL    = (process.env.APP_URL ?? 'http://204.168.191.215').replace(/\/$/, '')
const GW_TOKEN   = process.env.GATEWAY_API_TOKEN ?? ''

// ── Email via SMTP ────────────────────────────────────────────────────────────

function createTransporter() {
  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT ?? '587')
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
}

async function sendEmail(to: string, customerName: string, photoUrl: string, deliveredAt: Date) {
  const transporter = createTransporter()
  if (!transporter) {
    console.log(`[POD] SMTP ikke konfigureret — ville have sendt email til ${to}`)
    return
  }
  const tid = deliveredAt.toLocaleTimeString('da-DK', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Copenhagen',
  })
  const dato = deliveredAt.toLocaleDateString('da-DK', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Copenhagen',
  })
  await transporter.sendMail({
    from:    `"Venmark Fisk" <${process.env.SMTP_USER ?? 'ordre@venmark.dk'}>`,
    to,
    subject: `Levering bekræftet — ${customerName}`,
    html: `
<!DOCTYPE html><html lang="da">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:system-ui,sans-serif">
  <div style="max-width:520px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="background:#16a34a;padding:24px 32px;color:white">
      <div style="font-size:20px;font-weight:700">Venmark<span style="opacity:0.7">.dk</span></div>
      <div style="margin-top:4px;opacity:0.9;font-size:14px">✓ Levering bekræftet</div>
    </div>
    <div style="padding:24px 32px">
      <p style="margin:0 0 16px;color:#374151">Kære kunde,</p>
      <p style="margin:0 0 24px;color:#374151">
        Din levering fra <strong>Venmark Fisk</strong> er afleveret<br/>
        <strong>${dato} kl. ${tid}</strong>
      </p>
      <div style="text-align:center;margin-bottom:24px">
        <a href="${photoUrl}"
           style="display:inline-block;background:#16a34a;color:#fff;padding:12px 28px;
                  border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">
          📷 Se leveringsfoto
        </a>
      </div>
      <p style="color:#9ca3af;font-size:12px;margin:0">Linket er gyldigt i 30 dage.</p>
    </div>
    <div style="padding:14px 32px;background:#f8f8f8;font-size:11px;color:#999;text-align:center">
      Venmark Fisk A/S · venmark.dk
    </div>
  </div>
</body></html>`,
  })
  console.log(`[POD] Email sendt til ${to}`)
}

// ── SMS via GatewayAPI ────────────────────────────────────────────────────────

async function sendSms(phone: string, photoUrl: string) {
  if (!GW_TOKEN) {
    console.log(`[POD] GATEWAY_API_TOKEN ikke sat — ville have sendt SMS til ${phone}`)
    return
  }
  const normalized = phone.replace(/\s/g, '').replace(/^\+/, '').replace(/^0045/, '45').replace(/^(?!45)/, '45')
  const res = await fetch('https://gatewayapi.com/rest/mtsms', {
    method:  'POST',
    headers: { 'Authorization': `Token ${GW_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender:     'Venmark',
      message:    `Venmark Fisk: Din levering er afleveret. Se foto: ${photoUrl}`,
      recipients: [{ msisdn: normalized }],
    }),
  })
  if (!res.ok) console.error(`[POD] SMS fejl til ${normalized}: ${await res.text()}`)
  else         console.log(`[POD] SMS sendt til ${normalized}`)
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
  const photoUrl = `${APP_URL}/pod/${opts.stopId}`

  const targets: PodRecipient[] = TEST_MODE
    ? [{ email: TEST_EMAIL, phone: TEST_PHONE, sendEmail: true, sendSms: true }]
    : opts.recipients.filter(r => r.sendEmail || r.sendSms)

  if (targets.length === 0) {
    console.log(`[POD] Ingen modtagere konfigureret for ${opts.customerName}`)
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
