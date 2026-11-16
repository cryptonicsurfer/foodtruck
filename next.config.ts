import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) for the Docker image.
  output: "standalone",
  env: {
    DIRECTUS_URL: process.env.DIRECTUS_URL || 'https://cms.businessfalkenberg.se',
    APP_URL: process.env.APP_URL || 'http://localhost:3000',
    NEXT_PUBLIC_DIRECTUS_URL: process.env.NEXT_PUBLIC_DIRECTUS_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  publicRuntimeConfig: {
    directusUrl: process.env.NEXT_PUBLIC_DIRECTUS_URL,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  },
  // /idag is public but must stay out of search engines (the page also sets robots meta).
  async headers() {
    return [{ source: "/idag", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] }]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cms.businessfalkenberg.se',
        port: '',
        pathname: '/assets/**',
      },
    ],
  },
};

export default nextConfig;