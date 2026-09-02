import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionProviderWrapper } from '@/components/auth/session-provider';
import { ThemeProvider } from 'next-themes';
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: 'swap',
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F7FB" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1024" },
  ],
};

export const metadata: Metadata = {
  title: "CRM Pro - Sistema de Gestão de Clientes",
  description: "Sistema completo de gestão de relacionamento com clientes. Gerencie clientes, tags, lembretes e muito mais.",
  keywords: ["CRM", "gestão de clientes", "CRM Pro", "sales", "relationship management"],
  authors: [{ name: "CRM Pro Team" }],
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "CRM Pro - Sistema de Gestão de Clientes",
    description: "Sistema completo de gestão de relacionamento com clientes.",
    type: "website",
    images: [
      {
        url: "/brand/open-graph-light.png",
        width: 1200,
        height: 630,
        alt: "CRM Pro — Conexões que avançam.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CRM Pro - Sistema de Gestão de Clientes",
    description: "Sistema completo de gestão de relacionamento com clientes.",
    images: ["/brand/open-graph-light.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange={false}
        >
          <SessionProviderWrapper>{children}</SessionProviderWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
