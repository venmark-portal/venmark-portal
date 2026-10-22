'use client'

import { useT } from '@/lib/i18n/portal/LangProvider'
import { fakturaDict } from '@/lib/i18n/portal/dict/faktura'

export default function PrintButtons() {
  const t = useT(fakturaDict)
  return (
    <div style={{ marginBottom: '20px', display: 'flex', gap: '8px' }}>
      <button
        onClick={() => window.print()}
        style={{
          background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '6px',
          padding: '8px 20px', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
        }}
      >
        {t('udskriv')}
      </button>
      <button
        onClick={() => window.close()}
        style={{
          background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '6px',
          padding: '8px 16px', cursor: 'pointer', fontSize: '13px',
        }}
      >
        {t('luk')}
      </button>
    </div>
  )
}
