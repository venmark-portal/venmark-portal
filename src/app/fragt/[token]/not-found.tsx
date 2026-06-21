export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md bg-white p-6 rounded shadow border text-center">
        <h1 className="text-xl font-bold mb-3 text-red-700">Linket er ugyldigt eller udløbet</h1>
        <p className="text-sm text-gray-700 mb-2">
          Token-linket kan være forældet, deaktiveret eller skrevet forkert.
        </p>
        <p className="text-sm text-gray-700">
          Kontakt Venmark Fisk for at få et nyt link.
        </p>
      </div>
    </div>
  )
}
