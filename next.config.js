/** @type {import('next').NextConfig} */
const nextConfig = {
  // Gør det muligt at bygge ved siden af den kørende app: scripts/deploy.sh bygger med
  // NEXT_DIST_DIR=.next-new og flytter først mappen på plads når byggeriet er færdigt.
  // Uden det skrev `next build` direkte i .next mens serveren læste derfra, og portalen
  // svarede 502 i hele byggeperioden — og blev dér hvis byggeriet fejlede undervejs.
  // Ved kørsel er variablen ikke sat, så serveren læser som altid fra .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  typescript: { ignoreBuildErrors: true },
  // puppeteer er kun installeret på produktionsserveren (Hetzner), ikke lokalt
  experimental: { serverComponentsExternalPackages: ['puppeteer'] },
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals = [...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)), 'puppeteer']
    }
    return config
  },
  async headers() {
    return [
      {
        source: '/chauffeur/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.businesscentral.dynamics.com',
      },
      {
        protocol: 'https',
        hostname: '**.blob.core.windows.net',
      },
    ],
  },
}

module.exports = nextConfig
