import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const isProduction = process.env.NODE_ENV === 'production'

  return new PrismaClient({
    ...(isProduction
      ? {
          // Em produção (Vercel + Supabase), usar connection pooling
          // para evitar esgotar conexões do PostgreSQL
          datasources: {
            db: {
              url: process.env.DATABASE_URL,
            },
          },
        }
      : {
          // Em desenvolvimento, logar queries para debug
          log: ['query', 'warn', 'error'],
        }),
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
