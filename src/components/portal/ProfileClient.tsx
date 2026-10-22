'use client'

import { useState, useTransition } from 'react'
import {
  addFavorite, removeFavorite,
  addBlockedItem, removeBlockedItem,
  changePassword,
} from '@/app/portal/(protected)/profil/actions'
import ItemSearchModal from './ItemSearchModal'
import {
  Star, StarOff, EyeOff, Eye, KeyRound,
  Plus, Trash2, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react'
import type { BCItem } from '@/lib/businesscentral'
import { useT } from '@/lib/i18n/portal/LangProvider'
import { profilDict } from '@/lib/i18n/portal/dict/profil'

type Favorite = { bcItemNumber: string; itemName: string; sortOrder: number }

type Tab = 'favoritter' | 'skjulte' | 'adgangskode'

export default function ProfileClient({
  initialFavorites,
  initialBlocked,
}: {
  initialFavorites: Favorite[]
  initialBlocked:   string[]
}) {
  const t = useT(profilDict)
  const [tab,       setTab]       = useState<Tab>('favoritter')
  const [favorites, setFavorites] = useState(initialFavorites)
  const [blocked,   setBlocked]   = useState(initialBlocked)
  const [favSearch, setFavSearch] = useState(false)
  const [blkSearch, setBlkSearch] = useState(false)
  const [isPending, startTransition] = useTransition()

  // ── Favoritter ──────────────────────────────────────────────────────────────
  function handleAddFavorites(items: (BCItem & { unitPrice: number })[]) {
    const newItems = items.filter(item => !favorites.some(f => f.bcItemNumber === item.number))
    if (newItems.length === 0) return
    startTransition(async () => {
      for (const item of newItems) {
        // Gemmes med det danske navn (navnDa fra søgningen) — visningen oversætter selv.
        await addFavorite(item.number, (item as { navnDa?: string }).navnDa || item.displayName)
      }
      setFavorites(prev => [
        ...prev,
        ...newItems.map((item, i) => ({ bcItemNumber: item.number, itemName: item.displayName, sortOrder: prev.length + i })),
      ])
    })
  }

  function handleRemoveFav(bcItemNumber: string) {
    startTransition(async () => {
      await removeFavorite(bcItemNumber)
      setFavorites((prev) => prev.filter((f) => f.bcItemNumber !== bcItemNumber))
    })
  }

  // ── Skjulte varer ───────────────────────────────────────────────────────────
  const [blockedNames, setBlockedNames] = useState<Record<string, string>>({})

  function handleAddBlocked(item: BCItem & { unitPrice: number }) {
    setBlkSearch(false)
    if (blocked.includes(item.number)) return
    startTransition(async () => {
      await addBlockedItem(item.number, (item as { navnDa?: string }).navnDa || item.displayName)
      setBlocked((prev) => [...prev, item.number])
      setBlockedNames((prev) => ({ ...prev, [item.number]: item.displayName }))
      // Fjern fra favoritter lokalt hvis tilstede
      setFavorites((prev) => prev.filter((f) => f.bcItemNumber !== item.number))
    })
  }

  function handleRemoveBlocked(bcItemNumber: string) {
    startTransition(async () => {
      await removeBlockedItem(bcItemNumber)
      setBlocked((prev) => prev.filter((n) => n !== bcItemNumber))
    })
  }

  // ── Adgangskode ─────────────────────────────────────────────────────────────
  const [pwForm,   setPwForm]   = useState({ current: '', next: '', confirm: '' })
  const [pwMsg,    setPwMsg]    = useState<{ ok: boolean; text: string } | null>(null)
  const [pwPending, startPwTransition] = useTransition()

  function handleChangePassword() {
    setPwMsg(null)
    if (!pwForm.current || !pwForm.next || !pwForm.confirm) {
      setPwMsg({ ok: false, text: t('udfyldAlle') }); return
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwMsg({ ok: false, text: t('stemmerIkke') }); return
    }
    startPwTransition(async () => {
      try {
        await changePassword(pwForm.current, pwForm.next)
        setPwMsg({ ok: true, text: t('kodeAendret') })
        setPwForm({ current: '', next: '', confirm: '' })
      } catch (err) {
        setPwMsg({ ok: false, text: err instanceof Error ? err.message : t('fejl') })
      }
    })
  }

  // ── Tabs UI ─────────────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string; Icon: React.ElementType; count?: number }[] = [
    { id: 'favoritter',  label: t('favoritter'), Icon: Star,    count: favorites.length },
    { id: 'skjulte',     label: t('skjulteVarer'), Icon: EyeOff,  count: blocked.length > 0 ? blocked.length : undefined },
    { id: 'adgangskode', label: t('adgangskode'), Icon: KeyRound },
  ]

  return (
    <div className="space-y-4">
      {/* ── Tab-bjælke ── */}
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
        {tabs.map(({ id, label, Icon, count }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={15} />
            <span className="hidden sm:inline">{label}</span>
            {count !== undefined && (
              <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                tab === id ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══ FAVORITTER ══════════════════════════════════════════════════════════ */}
      {tab === 'favoritter' && (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-sm text-gray-500">
              {t('favInfo')}
            </p>
          </div>

          {favorites.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-400">
              <Star size={32} className="mx-auto mb-2 text-gray-200" />
              {t('ingenFav')}
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {favorites.map((fav) => (
                <div key={fav.bcItemNumber} className="flex items-center gap-3 px-4 py-3">
                  <Star size={15} className="shrink-0 text-amber-400" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">{fav.itemName}</div>
                    <div className="font-mono text-xs text-gray-400">{fav.bcItemNumber}</div>
                  </div>
                  <button
                    onClick={() => handleRemoveFav(fav.bcItemNumber)}
                    disabled={isPending}
                    className="rounded p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                    title={t('fjernFav')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-gray-100 px-4 py-3">
            <button
              onClick={() => setFavSearch(true)}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
            >
              <Plus size={15} />
              {t('tilfoejFav')}
            </button>
          </div>
        </div>
      )}

      {/* ══ SKJULTE VARER ═══════════════════════════════════════════════════════ */}
      {tab === 'skjulte' && (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-sm text-gray-500">
              {t('skjulteInfo')}
            </p>
          </div>

          {blocked.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-400">
              <EyeOff size={32} className="mx-auto mb-2 text-gray-200" />
              {t('ingenSkjulte')}
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {blocked.map((num) => (
                <div key={num} className="flex items-center gap-3 px-4 py-3">
                  <EyeOff size={15} className="shrink-0 text-gray-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900">
                      {blockedNames[num] ?? num}
                    </div>
                    <div className="font-mono text-xs text-gray-400">{num}</div>
                  </div>
                  <button
                    onClick={() => handleRemoveBlocked(num)}
                    disabled={isPending}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                    title={t('visIgen')}
                  >
                    <Eye size={13} />
                    {t('visIgen')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-gray-100 px-4 py-3">
            <button
              onClick={() => setBlkSearch(true)}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800"
            >
              <Plus size={15} />
              {t('skjulVare')}
            </button>
          </div>
        </div>
      )}

      {/* ══ ADGANGSKODE ═════════════════════════════════════════════════════════ */}
      {tab === 'adgangskode' && (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
          <div className="space-y-4 px-4 py-5">
            {pwMsg && (
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                pwMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                {pwMsg.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                {pwMsg.text}
              </div>
            )}

            {[
              { label: t('nuvaerende'), key: 'current',  ph: '••••••••' },
              { label: t('nyKode'),     key: 'next',     ph: t('min8') },
              { label: t('bekraeft'),   key: 'confirm',  ph: '••••••••' },
            ].map(({ label, key, ph }) => (
              <div key={key}>
                <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
                <input
                  type="password"
                  placeholder={ph}
                  value={pwForm[key as keyof typeof pwForm]}
                  onChange={(e) => setPwForm({ ...pwForm, [key]: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            ))}

            <button
              onClick={handleChangePassword}
              disabled={pwPending}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {pwPending ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              {t('skiftKode')}
            </button>
          </div>
        </div>
      )}

      {/* ── Søgemodalerne ── */}
      {favSearch && (
        <ItemSearchModal
          onAddFavorites={handleAddFavorites}
          onClose={() => setFavSearch(false)}
          existingNos={new Set(favorites.map(f => f.bcItemNumber))}
        />
      )}
      {blkSearch && (
        <ItemSearchModal
          onSelect={handleAddBlocked}
          onClose={() => setBlkSearch(false)}
        />
      )}
    </div>
  )
}
