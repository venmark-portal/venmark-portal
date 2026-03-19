'use client'

import { Search, X } from 'lucide-react'
import { useRef } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
}

export default function SearchBar({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="relative w-full max-w-lg">
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400"
        size={18}
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Søg på varenummer eller navn..."
        className="
          w-full rounded-lg border border-steel-300
          bg-white py-2.5 pl-10 pr-10
          text-sm text-steel-800 placeholder-steel-400
          shadow-sm outline-none
          focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20
          transition
        "
      />
      {value && (
        <button
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-steel-400 hover:text-steel-700"
          aria-label="Ryd søgning"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
