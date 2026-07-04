import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" é necessário para Vercel deployment com Prisma
  output: "standalone",

  typescript: {
    ignoreBuildErrors: true,
  },

  reactStrictMode: true,

  // Allow Supabase Storage images in next/image
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  // Headers de segurança para produção
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
