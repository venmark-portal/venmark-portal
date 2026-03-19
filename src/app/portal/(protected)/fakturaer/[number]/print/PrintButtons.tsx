'use client'

export default function PrintButtons() {
  return (
    <div style={{ marginBottom: '20px', display: 'flex', gap: '8px' }}>
      <button
        onClick={() => window.print()}
        style={{
          background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '6px',
          padding: '8px 20px', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
        }}
      >
        🖨️ Udskriv / Gem som PDF
      </button>
      <button
        onClick={() => window.close()}
        style={{
          background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '6px',
          padding: '8px 16px', cursor: 'pointer', fontSize: '13px',
        }}
      >
        Luk
      </button>
    </div>
  )
}
