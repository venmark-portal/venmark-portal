import nodemailer from 'nodemailer'
import { formatLongDate } from './dateUtils'

// ─── Konfigurer transporter ───────────────────────────────────────────────────

function createTransporter() {
  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT ?? '587')
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    // Ingen SMTP konfigureret — log til console i stedet
    return null
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })
}

// ─── Send reklamations-notifikation ───────────────────────────────────────────

interface TicketEmailData {
  ticket:   { id: string; subject: string; body: string; orderRef: string | null }
  customer: { name: string; bcCustomerNumber: string; email: string }
}

export async function sendTicketNotification(data: TicketEmailData) {
  const { ticket, customer } = data
  const to   = process.env.NOTIFICATION_EMAIL ?? 'ordre@venmark.dk'
  const from  = process.env.SMTP_USER ?? 'no-reply@venmark.dk'
  const baseUrl = process.env.NEXTAUTH_URL ?? 'https://venmark.dk'
  const adminLink = `${baseUrl}/admin/reklamationer/${ticket.id}`

  const html = `
<!DOCTYPE html>
<html lang="da">
<head><meta charset="UTF-8" /><title>Ny reklamation</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:system-ui,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="background:#dc2626;padding:24px 32px;color:white">
      <div style="font-size:20px;font-weight:700">Venmark<span style="opacity:0.7">.dk</span></div>
      <div style="margin-top:4px;opacity:0.9;font-size:14px">⚠️ Ny reklamation modtaget</div>
    </div>
    <div style="padding:24px 32px">
      <table style="width:100%;margin-bottom:20px">
        <tr>
          <td style="padding:4px 0;color:#666;font-size:13px;width:120px">Kunde</td>
          <td style="padding:4px 0;font-weight:600">${customer.name} (#${customer.bcCustomerNumber})</td>
        </tr>
        ${ticket.orderRef ? `<tr><td style="padding:4px 0;color:#666;font-size:13px">Ordrenr.</td><td style="padding:4px 0">${ticket.orderRef}</td></tr>` : ''}
        <tr>
          <td style="padding:4px 0;color:#666;font-size:13px">Emne</td>
          <td style="padding:4px 0;font-weight:600">${ticket.subject}</td>
        </tr>
      </table>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;font-size:14px;line-height:1.6;color:#374151;white-space:pre-wrap">${ticket.body}</div>
      <div style="margin-top:24px;text-align:center">
        <a href="${adminLink}"
          style="display:inline-block;background:#dc2626;color:white;padding:12px 28px;border-radius:8px;font-weight:600;text-decoration:none;font-size:14px">
          💬 Se reklamation og svar
        </a>
      </div>
    </div>
    <div style="padding:16px 32px;background:#f8f8f8;font-size:11px;color:#999;text-align:center">
      Venmark Fisk A/S · ordre@venmark.dk
    </div>
  </div>
</body>
</html>`

  const transporter = createTransporter()
  if (!transporter) {
    console.log(`\n📧 [REKLAMATION EMAIL → ${to}]`)
    console.log(`Kunde: ${customer.name} | Emne: ${ticket.subject}`)
    console.log(`Admin link: ${adminLink}\n`)
    return
  }
  await transporter.sendMail({
    from,
    to,
    subject: `⚠️ Ny reklamation — ${customer.name}: ${ticket.subject}`,
    html,
  })
}

// ─── Send password reset email ───────────────────────────────────────────────

export async function sendPasswordResetEmail(email: string, resetLink: string) {
  const from = process.env.SMTP_USER ?? 'no-reply@venmark.dk'

  const html = `
<!DOCTYPE html>
<html lang="da">
<head><meta charset="UTF-8" /><title>Nulstil adgangskode</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:system-ui,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="background:#1d4ed8;padding:24px 32px;color:white">
      <div style="font-size:20px;font-weight:700">Venmark<span style="opacity:0.7">.dk</span></div>
      <div style="margin-top:4px;opacity:0.9;font-size:14px">Nulstilling af adgangskode</div>
    </div>
    <div style="padding:32px">
      <p style="margin:0 0 16px;font-size:15px;color:#374151">
        Vi har modtaget en anmodning om at nulstille adgangskoden til din konto på Venmark.dk.
      </p>
      <p style="margin:0 0 24px;font-size:15px;color:#374151">
        Klik på knappen nedenfor for at vælge en ny adgangskode. Linket er gyldigt i <strong>1 time</strong>.
      </p>
      <div style="text-align:center;margin-bottom:24px">
        <a href="${resetLink}"
          style="display:inline-block;background:#1d4ed8;color:white;padding:14px 32px;border-radius:8px;font-weight:600;text-decoration:none;font-size:15px">
          Nulstil adgangskode
        </a>
      </div>
      <p style="margin:0;font-size:13px;color:#9ca3af">
        Hvis du ikke har anmodet om dette, kan du blot ignorere denne email — din adgangskode forbliver uændret.
      </p>
    </div>
    <div style="padding:16px 32px;background:#f8f8f8;font-size:11px;color:#999;text-align:center">
      Venmark Fisk A/S · ordre@venmark.dk
    </div>
  </div>
</body>
</html>`

  const transporter = createTransporter()
  if (!transporter) {
    console.log(`\n🔑 [RESET PASSWORD EMAIL → ${email}]`)
    console.log(`Link: ${resetLink}\n`)
    return
  }
  await transporter.sendMail({
    from,
    to: email,
    subject: 'Nulstil din adgangskode — Venmark.dk',
    html,
  })
}

// ─── Send ordre-notifikation ──────────────────────────────────────────────────

interface OrderEmailData {
  customer: { name: string; email: string; bcCustomerNumber: string }
  order:    { id: string; deliveryDate: Date; notes: string | null }
  lines:    { bcItemNumber: string; itemName: string; quantity: number; uom: string; unitPrice: number }[]
}

export async function sendOrderNotification(data: OrderEmailData) {
  const { customer, order, lines } = data
  const to   = process.env.NOTIFICATION_EMAIL ?? 'ordre@venmark.dk'
  const from  = process.env.SMTP_USER ?? 'no-reply@venmark.dk'

  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const fmt   = new Intl.NumberFormat('da-DK', {
    style: 'currency', currency: 'DKK', minimumFractionDigits: 2,
  })

  const linesHtml = lines
    .map(
      (l) => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:12px;color:#666">${l.bcItemNumber}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0">${l.itemName}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-weight:600">${l.quantity}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;color:#666">${l.uom}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:right">${l.unitPrice > 0 ? fmt.format(l.unitPrice) : '—'}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600">${l.unitPrice > 0 ? fmt.format(l.quantity * l.unitPrice) : '—'}</td>
      </tr>`
    )
    .join('')

  const html = `
<!DOCTYPE html>
<html lang="da">
<head><meta charset="UTF-8" /><title>Ny bestilling</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:system-ui,sans-serif">
  <div style="max-width:640px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

    <!-- Header -->
    <div style="background:#1d4ed8;padding:24px 32px;color:white">
      <div style="font-size:20px;font-weight:700">Venmark<span style="opacity:0.7">.dk</span></div>
      <div style="margin-top:4px;opacity:0.9;font-size:14px">Ny bestilling modtaget</div>
    </div>

    <!-- Body -->
    <div style="padding:24px 32px">
      <table style="width:100%;margin-bottom:20px">
        <tr>
          <td style="padding:4px 0;color:#666;font-size:13px">Kunde</td>
          <td style="padding:4px 0;font-weight:600">${customer.name} (#${customer.bcCustomerNumber})</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#666;font-size:13px">Levering</td>
          <td style="padding:4px 0;font-weight:600">${formatLongDate(order.deliveryDate)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#666;font-size:13px">Ordre-ID</td>
          <td style="padding:4px 0;font-family:monospace;font-size:12px;color:#666">${order.id}</td>
        </tr>
        ${order.notes ? `<tr><td style="padding:4px 0;color:#666;font-size:13px">Bemærkning</td><td style="padding:4px 0;font-style:italic">"${order.notes}"</td></tr>` : ''}
      </table>

      <!-- Linjer -->
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f8f8f8">
            <th style="padding:8px 12px;text-align:left;color:#666;font-weight:600;font-size:11px;text-transform:uppercase">Varenr.</th>
            <th style="padding:8px 12px;text-align:left;color:#666;font-weight:600;font-size:11px;text-transform:uppercase">Vare</th>
            <th style="padding:8px 12px;text-align:center;color:#666;font-weight:600;font-size:11px;text-transform:uppercase">Antal</th>
            <th style="padding:8px 12px;text-align:left;color:#666;font-weight:600;font-size:11px;text-transform:uppercase">Enhed</th>
            <th style="padding:8px 12px;text-align:right;color:#666;font-weight:600;font-size:11px;text-transform:uppercase">Pris</th>
            <th style="padding:8px 12px;text-align:right;color:#666;font-weight:600;font-size:11px;text-transform:uppercase">Total</th>
          </tr>
        </thead>
        <tbody>${linesHtml}</tbody>
        ${total > 0 ? `
        <tfoot>
          <tr>
            <td colspan="5" style="padding:10px 12px;text-align:right;font-weight:700;font-size:14px">Total</td>
            <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:14px">${fmt.format(total)}</td>
          </tr>
        </tfoot>` : ''}
      </table>

      <!-- Godkend-link -->
      <div style="margin-top:24px;text-align:center">
        <a href="${process.env.NEXTAUTH_URL ?? 'https://venmark.dk'}/admin"
          style="display:inline-block;background:#16a34a;color:white;padding:12px 28px;border-radius:8px;font-weight:600;text-decoration:none;font-size:14px">
          ✓ Gå til godkendelse
        </a>
      </div>
    </div>

    <div style="padding:16px 32px;background:#f8f8f8;font-size:11px;color:#999;text-align:center">
      Venmark Fisk A/S · ordre@venmark.dk
    </div>
  </div>
</body>
</html>`

  const transporter = createTransporter()

  if (!transporter) {
    // Ingen SMTP — log til console
    console.log(`\n📧 [EMAIL VILLE BLIVE SENDT TIL: ${to}]`)
    console.log(`Emne: Ny bestilling — ${customer.name} — levering ${formatLongDate(order.deliveryDate)}`)
    console.log(`Linjer: ${lines.length}, Total: ${total > 0 ? fmt.format(total) : 'ikke prissat'}\n`)
    return
  }

  await transporter.sendMail({
    from,
    to,
    subject: `Ny bestilling — ${customer.name} — levering ${formatLongDate(order.deliveryDate)}`,
    html,
  })
}
