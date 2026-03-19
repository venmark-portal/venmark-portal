'use client'

import Image from 'next/image'
import { Camera, Tag } from 'lucide-react'
import type { BCItem } from '@/lib/businesscentral'

interface Props {
  item: BCItem
}

function StockBadge({ qty }: { qty: number }) {
  if (qty > 10) {
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        På lager
      </span>
    )
  }
  if (qty > 0) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        Få tilbage ({qty})
      </span>
    )
  }
  return (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
      Ikke på lager
    </span>
  )
}

export default function ProductCard({ item }: Props) {
  const bcImageUrl = item.picture?.['pictureContent@odata.mediaReadLink']
  // BC returnerer altid en pictureContent-URL, selv for varer uden billede.
  // Vi tjekker width > 0 eller contentType !== '' for at afgøre om billedet eksisterer.
  const hasRealImage =
    (item.picture?.width ?? 0) > 0 ||
    (item.picture?.contentType ?? '') !== ''
  // Brug proxy-endpoint da BC kræver Bearer token for billeder
  const imageUrl =
    bcImageUrl && hasRealImage
      ? `/api/image?url=${encodeURIComponent(bcImageUrl)}`
      : null

  const price =
    item.unitPrice > 0
      ? new Intl.NumberFormat('da-DK', {
          style:    'currency',
          currency: 'DKK',
          minimumFractionDigits: 2,
        }).format(item.unitPrice)
      : null

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-steel-200 bg-white shadow-sm transition hover:shadow-md hover:-translate-y-0.5">
      {/* Billede */}
      <div className="relative flex h-48 items-center justify-center bg-steel-50">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={item.displayName}
            fill
            className="object-contain p-4"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-full bg-steel-100 p-4">
              <Camera className="text-steel-400" size={28} />
            </div>
            <span className="rounded-md border border-dashed border-steel-300 bg-white px-3 py-1 text-xs font-medium italic text-steel-400">
              📸 Fotografen er på vej
            </span>
          </div>
        )}
        {item.itemCategoryCode && (
          <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 border border-brand-200">
            <Tag size={10} />
            {item.itemCategoryCode}
          </span>
        )}
      </div>

      {/* Indhold */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="font-mono text-xs text-steel-500">{item.number}</p>
        <h2 className="text-sm font-semibold leading-snug text-steel-800 line-clamp-2">
          {item.displayName}
        </h2>


        <div className="mt-auto flex items-end justify-between pt-3">
          <div>
            {price ? (
              <span className="text-lg font-bold text-brand-700">{price}</span>
            ) : (
              <span className="text-sm italic text-steel-400">Kontakt os for pris</span>
            )}
            {item.baseUnitOfMeasureCode && (
              <span className="ml-1 text-xs text-steel-400">
                / {item.baseUnitOfMeasureCode}
              </span>
            )}
          </div>
          <StockBadge qty={item.inventory} />
        </div>
      </div>
    </article>
  )
}
