// Genererer icon-192.png og icon-512.png til PWA via sharp (hvis installeret)
// eller gemmer SVG'er som fallback (omdøb manuelt til .png eller brug et konverteringsværktøj)
import { writeFileSync } from 'fs'

function svgIcon(size) {
  const r = Math.round(size * 0.18)
  const fontSize = Math.round(size * 0.58)
  const cy = Math.round(size / 2 + size * 0.03)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#2563eb"/>
  <text x="${size/2}" y="${cy}" font-family="Arial,sans-serif" font-weight="bold" font-size="${fontSize}" fill="white" text-anchor="middle" dominant-baseline="central">V</text>
</svg>`
}

// Gem som SVG (fungerer i de fleste browsere som ikon)
writeFileSync('public/icon-192.svg', svgIcon(192))
writeFileSync('public/icon-512.svg', svgIcon(512))
console.log('SVG-ikoner gemt. Opdater manifest.json type til image/svg+xml hvis du bruger SVG direkte.')
