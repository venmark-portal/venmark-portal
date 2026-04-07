import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function PodPage({ params }: { params: { id: string } }) {
  const stopId = params.id

  const rows = await prisma.$queryRaw<any[]>`
    SELECT s."customerName", s."customerAddress", s."deliveredAt",
           v."vehicleLabel", r."bookingDate",
           p.filename, p."takenAt", p.lat, p.lng
    FROM "RouteStop" s
    JOIN "RouteVehicle" v ON v.id = s."vehicleId"
    JOIN "DeliveryRoute" r ON r.id = v."routeId"
    LEFT JOIN "RouteStopPhoto" p ON p."stopId" = s.id
    WHERE s.id = ${stopId} AND s.status = 'DELIVERED'
    ORDER BY p."takenAt" DESC
    LIMIT 1
  `

  if (!rows.length) notFound()
  const row = rows[0]

  const dato = row.deliveredAt
    ? new Date(row.deliveredAt).toLocaleDateString('da-DK', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        timeZone: 'Europe/Copenhagen',
      })
    : null
  const tid = row.deliveredAt
    ? new Date(row.deliveredAt).toLocaleTimeString('da-DK', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Europe/Copenhagen',
      })
    : null

  const mapsUrl = row.lat && row.lng
    ? `https://www.google.com/maps?q=${row.lat},${row.lng}`
    : null

  return (
    <div style={{ margin: 0, padding: 0, background: '#f5f5f5', fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 16px' }}>

        {/* Header */}
        <div style={{ background: '#16a34a', borderRadius: 12, padding: '20px 24px', color: 'white', marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Venmark<span style={{ opacity: 0.7 }}>.dk</span></div>
          <div style={{ marginTop: 4, opacity: 0.9, fontSize: 14 }}>✓ Levering bekræftet</div>
        </div>

        {/* Info */}
        <div style={{ background: 'white', borderRadius: 12, padding: '20px 24px', marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{row.customerName ?? 'Levering'}</div>
          {row.customerAddress && (
            <div style={{ color: '#6b7280', fontSize: 14, marginBottom: 8 }}>📍 {row.customerAddress}</div>
          )}
          {dato && tid && (
            <div style={{ fontSize: 14, color: '#374151' }}>
              <strong>Leveret:</strong> {dato} kl. {tid}
            </div>
          )}
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12,
                       background: '#eff6ff', color: '#2563eb', padding: '8px 14px',
                       borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
              🗺 Se GPS-position
            </a>
          )}
          {!mapsUrl && (
            <div style={{ marginTop: 12, color: '#9ca3af', fontSize: 13 }}>GPS ikke tilgængelig</div>
          )}
        </div>

        {/* Foto */}
        {row.filename ? (
          <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.10)' }}>
            <img
              src={`/api/chauffeur/stop/${stopId}/photo`}
              alt="Leveringsfoto"
              style={{ width: '100%', display: 'block' }}
            />
            {row.takenAt && (
              <div style={{ background: 'white', padding: '10px 16px', fontSize: 12, color: '#9ca3af' }}>
                Foto taget kl. {new Date(row.takenAt).toLocaleTimeString('da-DK', {
                  hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Copenhagen',
                })}
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: 'white', borderRadius: 12, padding: 32, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
            Ingen foto registreret
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#9ca3af' }}>
          Venmark Fisk A/S · venmark.dk
        </div>
      </div>
    </div>
  )
}
