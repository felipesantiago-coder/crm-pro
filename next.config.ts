import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // "standalone" é necessário para Vercel deployment com Prisma
  output: "standalone",

  typescript: {
    ignoreBuildErrors: true,
  },

  reactStrictMode: true,

  // Allow Supabase Storage images in next/image
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
    // Optimize for mobile-first: 85% of LP traffic is mobile (IG IAB)
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 160, 256, 320],
  },

  // Headers de segurança para produção
  async headers() {
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self), browsing-topics=()" },
      // HSTS — força HTTPS por 1 ano (inclui subdomínios). Vercel já usa HTTPS,
      // mas o header protege contra downgrade attacks futuros.
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
      {
        key: "Content-Security-Policy",
        value: [
          `default-src 'self'`,
          `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net`,
          `style-src 'self' 'unsafe-inline'`,
          `img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com https://*.fbcdn.net`,
          `connect-src 'self' https://*.supabase.co https://api.telegram.org https://generativelanguage.googleapis.com https://graph.facebook.com https://api.instagram.com https://*.meta.gg https://wa.me`,
          `frame-src https://calendar.google.com`,
          `font-src 'self' data:`,
          `object-src 'none'`,
          `base-uri 'self'`,
          `form-action 'self'`,
          `frame-ancestors 'none'`,
        ].join('; '),
      },
    ];

    return [
      { source: "/:path*", headers: securityHeaders },
    ];
  },
};

export default withNextIntl(nextConfig);
