import { PrismaClient } from '@prisma/client'

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
 * Supabase Free Tier pauses after inactivity — the first connection
 * attempt may fail while the DB is waking up.
 *
 * This function retries with increasing delays (2s, 3s, 4s) to give
 * the database enough time to resume from its paused state.
 * Total worst-case wait: ~9 seconds.
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
        // Increasing delay: 2s, 3s, 4s — gives Supabase time to wake up
        const delay = (attempt + 1) * 1000
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