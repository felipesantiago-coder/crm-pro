import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionProviderWrapper } from '@/components/auth/session-provider';
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CRM Pro - Sistema de Gestão de Clientes",
  description: "Sistema completo de gestão de relacionamento com clientes. Gerencie clientes, tags, lembretes e muito mais.",
  keywords: ["CRM", "gestão de clientes", "CRM Pro", "sales", "relationship management"],
  authors: [{ name: "CRM Pro Team" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "CRM Pro - Sistema de Gestão de Clientes",
    description: "Sistema completo de gestão de relacionamento com clientes.",
    type: "website",
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
        <SessionProviderWrapper>{children}</SessionProviderWrapper>
      </body>
    </html>
  );
}
