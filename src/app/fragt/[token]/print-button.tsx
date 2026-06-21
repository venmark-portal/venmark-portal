'use client'

// Lille client-komponent KUN til print-knappen. Resten af fragt-siden er
// server-rendret (godt til print + ingen client-JS afhængighed). En server-
// komponent må ikke have onClick, så knappen isoleres her.
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="px-4 py-2 border rounded hover:bg-gray-50"
    >
      Print
    </button>
  )
}
