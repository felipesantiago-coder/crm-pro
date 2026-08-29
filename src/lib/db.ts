import { PrismaClient } from '@prisma/client'

//
// INFRAESTRUTURA DO BANCO DE DADOS
// ================================
// Em produção (Vercel), DATABASE_URL aponta para o Supabase PostgreSQL.
// O Supabase free tier (Session pooler) limita a 15 conexões simultâneas.
// Por isso, connection_limit=1 para não estourar o limite no serverless.
//
// O Supabase também fornece: Object Storage (imagens) e Realtime (toasts na UI).
//
// Em desenvolvimento local, DATABASE_URL pode ser SQLite ou outra URL.
//

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    // Supabase Session pooler: max 15 concurrent connections.
    // Each Vercel serverless function instance gets its own PrismaClient.
    // Limit to 1 connection per instance to avoid exhausting the pool.
    ...(process.env.NODE_ENV === 'production'
      ? { connection_limit: 1 }
      : {}),
  })
}

// Lazy initialization: only creates PrismaClient when first accessed.
// This prevents build failures when DATABASE_URL is not set during
// static page collection in Vercel's build step.
function getDb() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient()
  }
  return globalForPrisma.prisma
}

// Use a Proxy so that any property access on `db` triggers lazy init.
// This means modules that `import { db }` won't crash at import time.
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getDb()
    const value = Reflect.get(client, prop, receiver)
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
})

/**
 * Ensures the database connection is alive.
 *
 * Neon pode suspender branches inativas (scale-to-zero) — a primeira
 * conexão pode falhar enquanto o banco está acordando (cold start).
 * Esta função retenta com delays crescentes (3s, 4s, 5s) para dar
 * tempo suficiente ao Neon reativar a conexão.
 * Pior caso: ~12 segundos de espera.
 */
export async function ensureDbConnection(maxRetries = 3): Promise<PrismaClient> {
  const client = getDb()
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await client.$queryRaw`SELECT 1 as ok`
      return client
    } catch (err) {
      console.error(`[DB] Connection attempt ${attempt}/${maxRetries} failed:`, err)
      if (attempt < maxRetries) {
        // Increasing delay: 3s, 4s, 5s — gives Neon time to wake up
        const delay = (attempt + 2) * 1000
        console.log(`[DB] Waiting ${delay}ms before retry...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        // Force a fresh connection on next attempt
        try { await client.$disconnect() } catch {}
      } else {
        console.error('[DB] All connection attempts failed')
        throw err
      }
    }
  }
  return client
}