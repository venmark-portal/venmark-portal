/** @type {import('next').NextConfig} */
const nextConfig = {
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
