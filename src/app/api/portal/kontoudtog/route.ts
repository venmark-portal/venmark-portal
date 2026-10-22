/**
 * GET /api/portal/kontoudtog?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returnerer kontoudtog (fakturaoversigt) som Excel-kompatibel CSV.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPostedInvoices } from '@/lib/businesscentral'
import { getPortalLang } from '@/lib/i18n/portal/server'
import { makeT, localeOf } from '@/lib/i18n/portal/lang'
import { fakturaDict } from '@/lib/i18n/portal/dict/faktura'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const lang   = await getPortalLang()
  const t      = makeT(fakturaDict, lang)
  const locale = localeOf(lang)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: t('ikkeLoggetInd') }, { status: 401 })

  const customerNo   = (session.user as any)?.bcCustomerNumber as string ?? ''
  const customerName = (session.user as any)?.name as string ?? customerNo

  const { searchParams } = req.nextUrl
  const from = searchParams.get('from') ?? (() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().split('T')[0]
  })()
  const to = searchParams.get('to') ?? new Date().toISOString().split('T')[0]

  // Hent fakturaer
  const allInvoices = await getPostedInvoices(customerNo, from)
  const invoices    = allInvoices.filter(inv => inv.postingDate <= to)

  // Totaler
  const totalAmount = invoices.reduce((s, inv) => s + inv.totalAmountIncludingTax, 0)
  const outstanding = invoices.reduce((s, inv) => s + inv.remainingAmount, 0)

  // ── Byg CSV (semikolon-separeret for dansk Excel) ────────────────────────
  const fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const rows: string[][] = []

  // Titel
  rows.push([t('kontoudtogTitel', { navn: customerName, nr: customerNo })])
  rows.push([t('periode', { fra: from, til: to })])
  rows.push([t('genereret', { dato: new Date().toLocaleDateString(locale) })])
  rows.push([])

  // Header
  rows.push([
    t('fakturanr'),
    t('fakturadato'),
    t('forfaldsdato'),
    t('betalingsbetingelse'),
    t('eksklMomsKol'),
    t('inklMomsKol'),
    t('udestaaende'),
    t('status'),
  ])

  // Data-rækker
  for (const inv of invoices) {
    const dueDate = inv.dueDate ?? ''
    const isOverdue = dueDate && !inv.closed && dueDate < new Date().toISOString().split('T')[0]
    const status = inv.closed || inv.remainingAmount === 0
      ? t('betalt')
      : isOverdue
        ? t('forfaldent')
        : t('udestaaende')

    rows.push([
      inv.number,
      inv.postingDate,
      dueDate,
      inv.paymentTermsCode,
      fmt.format(inv.totalAmountExcludingTax),
      fmt.format(inv.totalAmountIncludingTax),
      fmt.format(inv.remainingAmount),
      status,
    ])
  }

  // Totallinje
  rows.push([])
  rows.push(['', '', '', t('total'), '', fmt.format(totalAmount), fmt.format(outstanding), ''])

  // Konverter til CSV med semikolon (dansk Excel-standard)
  const csv = rows
    .map(row =>
      row.map(cell => {
        // Escape celler der indeholder semikolon, linjeskift eller citationstegn
        const s = String(cell ?? '')
        if (s.includes(';') || s.includes('"') || s.includes('\n')) {
          return `"${s.replace(/"/g, '""')}"`
        }
        return s
      }).join(';')
    )
    .join('\r\n')

  // UTF-8 BOM så Excel viser æøå korrekt
  const BOM  = '\uFEFF'
  const body = BOM + csv

  // Filnavnet i headeren skal være ASCII — de oversatte præfikser er det (Kontoudtog/Statement/Kontoauszug).
  const filename = `${t('kontoudtogFil')}-${customerNo}-${from}-${to}.csv`

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
