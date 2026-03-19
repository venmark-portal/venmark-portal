'use client'

import type { BCItemCategory } from '@/lib/businesscentral'

interface Props {
  categories: BCItemCategory[]
  selected:   string
  onChange:   (code: string) => void
}

export default function CategoryFilter({ categories, selected, onChange }: Props) {
  if (categories.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onChange('')}
        className={`
          rounded-full border px-4 py-1.5 text-sm font-medium transition
          ${selected === ''
            ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
            : 'border-steel-300 bg-white text-steel-700 hover:border-brand-400 hover:text-brand-600'
          }
        `}
      >
        Alle varer
      </button>

      {categories.map((cat) => (
        <button
          key={cat.code}
          onClick={() => onChange(cat.code)}
          className={`
            rounded-full border px-4 py-1.5 text-sm font-medium transition
            ${selected === cat.code
              ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
              : 'border-steel-300 bg-white text-steel-700 hover:border-brand-400 hover:text-brand-600'
            }
          `}
        >
          {cat.displayName}
        </button>
      ))}
    </div>
  )
}
