// Vises automatisk mens bestil-siden (server-komponent) henter favoritter + beregner disponibelt
// lager (~7 sek). Erstatter indholdet under load — så kunden ved at der arbejdes.
export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center gap-5 px-6 py-24 text-center">
      <div className="relative">
        <div className="h-14 w-14 rounded-full border-4 border-blue-100 border-t-blue-500 animate-spin" />
        <span className="absolute inset-0 flex items-center justify-center text-2xl">⏳</span>
      </div>
      <div>
        <p className="text-lg font-semibold text-gray-800">Vi beregner lige disponibelt lager</p>
        <p className="mt-1 text-sm text-gray-500">Hav 7 sekunders tålmodighed…</p>
      </div>
    </div>
  )
}
