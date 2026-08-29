import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  experimental: {
    // Keep the agent/commerce/visa packages in the server bundle graph.
    serverActions: { bodySizeLimit: '2mb' },
  },
}

export default nextConfig
