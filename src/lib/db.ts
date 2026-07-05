import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// ── Connection error detection ──────────────────────────────
// Prisma codes: P1001 (can't reach server), P1008 (timeout)
// pg-driver codes: ECONNREFUSED, ETIMEDOUT, connection closed, etc.
function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const msg = (err as { message?: string }).message ?? ''
  const code = (err as { code?: string }).code ?? ''
  if (code.startsWith('P1001') || code.startsWith('P1008')) return true
  const lower = msg.toLowerCase()
  return (
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('connection refused') ||
    lower.includes('connection timed out') ||
    lower.includes('connection closed') ||
    lower.includes('too many connections') ||
    lower.includes('terminated unexpectedly') ||
    lower.includes('endpoint is not available') ||
    lower.includes('no pg_hba.conf entry') ||
    lower.includes('remaining connection slots') ||
    lower.includes('ssl') // Supabase sometimes returns SSL negotiation errors on wake-up
  )
}

const MAX_RETRIES = 3
const RETRY_DELAYS = [3000, 4000, 5000] // 3s, 4s, 5s

function createPrismaClient() {
  const baseClient = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  })

  // Extend with automatic retry for connection errors (Supabase cold-start).
  // This makes every query across all 76+ API routes resilient to DB pauses
  // without each route needing to call ensureDbConnection manually.
  return baseClient.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          let lastError: unknown
          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              return await query(args)
            } catch (err: unknown) {
              lastError = err
              if (isConnectionError(err) && attempt < MAX_RETRIES) {
                const delay = RETRY_DELAYS[attempt - 1] ?? 3000
                console.warn(
                  `[DB] Connection error on attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay}ms...`,
                  err instanceof Error ? err.message : err,
                )
                await new Promise((resolve) => setTimeout(resolve, delay))
                // Force reconnection
                try { await baseClient.$disconnect() } catch { /* ignore */ }
                continue
              }
              throw err
            }
          }
          throw lastError
        },
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
export const db = new Proxy({} as ReturnType<typeof createPrismaClient>, {
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
 * Still available for explicit use (e.g., in auth callbacks where a
 * warm connection is needed before a transaction), but all regular
 * API routes now get automatic retry via the client extension above.
 */
export async function ensureDbConnection(maxRetries = 3): Promise<PrismaClient> {
  // For explicit pre-warming, do a lightweight query through the retry-enabled client.
  const client = getDb()
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await client.$queryRaw`SELECT 1 as ok`
      return client as unknown as PrismaClient
    } catch (err) {
      console.error(`[DB] Connection attempt ${attempt}/${maxRetries} failed:`, err)
      if (attempt < maxRetries) {
        const delay = (attempt + 2) * 1000
        console.log(`[DB] Waiting ${delay}ms before retry...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        try { await client.$disconnect() } catch { /* ignore */ }
      } else {
        console.error('[DB] All connection attempts failed')
        throw err
      }
    }
  }
  return client as unknown as PrismaClient
}