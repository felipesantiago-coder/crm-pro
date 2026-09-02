import { PrismaClient } from '@prisma/client'

//
// INFRAESTRUTURA DO BANCO DE DADOS
// ================================
// Em produção (Vercel), DATABASE_URL aponta para o Supabase Transaction pooler
// (porta 6543, ?pgbouncer=true). O Transaction pooler multiplexa conexões,
// suportando centenas de clientes simultâneos com poucas conexões reais.
//
// IMPORTANTE: Não use transações interativas (db.$transaction(async tx => ...))
// com PgBouncer. Use batch transactions (db.$transaction([op1, op2])).
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
  // PgBouncer (Transaction pooler, porta 6543) multiplexa conexões automaticamente.
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
 * O Supabase pode apresentar falhas transitórias de conexão (pausa de
 * projeto inativo no plano gratuito, reciclagem de conexões do pooler)
 * — a primeira tentativa pode falhar momentaneamente. Esta função
 * retenta com delays crescentes (3s, 4s, 5s).
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
        // Increasing delay: 3s, 4s, 5s — dá tempo ao pooler/banco de se recuperar
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