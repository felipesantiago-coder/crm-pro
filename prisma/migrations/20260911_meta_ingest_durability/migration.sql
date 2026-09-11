-- ============================================================
-- Fase 3 da otimização Vercel — ingestão Meta durável e econômica
--
-- Propósito:
--   1. meta_lead_inbox     — inbox idempotente de leads (jobs):
--      webhook e polling persistem o evento ANTES do processamento
--      pesado; replay do mesmo leadgen reencontra a linha por
--      dedupKey e nunca duplica cliente/atribuição/Telegram.
--   2. meta_polling_cursor — cursor persistente por (adAccountId,
--      formId) substituindo as watermarks soltas em user_settings;
--      avança só até o último lead confirmado na inbox.
--   3. meta_polling_lease  — lock distribuído com TTL substituindo
--      o isRunning em memória; quotaRemaining reserva a quota do
--      run atomicamente (UPDATE condicional).
--
-- Gestão: `prisma migrate deploy` (npm run db:release) — NUNCA db push.
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS (estilo capi_event_logs).
-- Backfill: NENHUM necessário — inbox/cursor/lease nascem vazios;
--   os cursors são inicializados em runtime a partir de
--   meta_polling_form_watermarks (idempotente) na primeira execução.
--   Leads já existentes continuam protegidos pelo UNIQUE
--   clients."metaLeadgenId" (dedup dentro do pipeline).
--
-- Rollback (sem perda de leads — a tabela clients não é tocada):
--   DROP TABLE IF EXISTS "meta_polling_lease";
--   DROP TABLE IF EXISTS "meta_polling_cursor";
--   DROP TABLE IF EXISTS "meta_lead_inbox";
--   (após rollback, definir META_INGEST_V2=legacy e
--    META_POLL_CURSOR_V2=legacy para o código voltar ao caminho antigo)
-- ============================================================

-- 1. Inbox idempotente de leads Meta
CREATE TABLE IF NOT EXISTS "meta_lead_inbox" (
    "id" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "leadgenId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "adAccountId" TEXT,
    "formId" TEXT,
    "campaignId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "result" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_lead_inbox_pkey" PRIMARY KEY ("id")
);

-- Chave idempotente do evento (única — replay volta para a mesma linha)
CREATE UNIQUE INDEX IF NOT EXISTS "meta_lead_inbox_dedupKey_key" ON "meta_lead_inbox"("dedupKey");

-- Varredura do worker/drain: itens pendentes e vencidos primeiro
CREATE INDEX IF NOT EXISTS "meta_lead_inbox_status_nextAttemptAt_idx" ON "meta_lead_inbox"("status", "nextAttemptAt");

-- Observabilidade: histórico por leadgen
CREATE INDEX IF NOT EXISTS "meta_lead_inbox_leadgenId_idx" ON "meta_lead_inbox"("leadgenId");

-- 2. Cursor persistente de polling por (conta, formulário)
CREATE TABLE IF NOT EXISTS "meta_polling_cursor" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "cursorTime" TIMESTAMP(3) NOT NULL,
    "lastConfirmedLeadgenId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_polling_cursor_pkey" PRIMARY KEY ("id")
);

-- Um cursor por (conta, formulário) — a chave do prompt da Fase 3
CREATE UNIQUE INDEX IF NOT EXISTS "meta_polling_cursor_adAccountId_formId_key" ON "meta_polling_cursor"("adAccountId", "formId");

-- 3. Lease distribuído do polling (lock com TTL + quota atômica)
CREATE TABLE IF NOT EXISTS "meta_polling_lease" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "ownerToken" TEXT NOT NULL,
    "quotaRemaining" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "renewedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_polling_lease_pkey" PRIMARY KEY ("id")
);

-- Um lock por escopo ('polling' = execução global única)
CREATE UNIQUE INDEX IF NOT EXISTS "meta_polling_lease_scope_key" ON "meta_polling_lease"("scope");
