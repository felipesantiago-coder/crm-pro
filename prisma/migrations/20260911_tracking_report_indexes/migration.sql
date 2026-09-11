-- ============================================================
-- Migration 20260911_tracking_report_indexes — Fase 6
-- (tracking/relatórios — otimização Vercel)
--
-- O que esta migration faz:
--   1. Índices compostos para as consultas de dashboard/report
--      (janela temporal por site + filtros por eventType) e para as
--      consultas de visitors por (siteId, lastSeenAt).
--   2. Tabela tracking_rate_limit — rate limit DISTRIBUÍDO do
--      /api/track (contador por ip com reset de janela no próprio
--      statement atômico INSERT ... ON CONFLICT DO UPDATE ... RETURNING).
--
-- Idempotente (IF NOT EXISTS em tudo) — pode rodar antes ou depois
-- do deploy do código (o código degrada para o fallback in-memory
-- com WARN único se a tabela ainda não existir: P2021/P2022).
--
-- ROLLBACK (reverter esta migration):
--   DROP INDEX IF EXISTS "tracking_events_siteId_createdAt_idx";
--   DROP INDEX IF EXISTS "tracking_events_siteId_eventType_createdAt_idx";
--   DROP INDEX IF EXISTS "tracking_visitors_siteId_lastSeenAt_idx";
--   DROP TABLE IF EXISTS "tracking_rate_limit";
--   (índices são reconstruíveis; a tabela guarda apenas contadores
--    de janela — nenhum dado de negócio; com a tabela ausente o
--    endpoint cai para o fallback in-memory automaticamente)
--
-- ⚠️ EXPLAIN OBRIGATÓRIO no release (regra 8 do prompt — sandbox sem
-- Postgres): scripts/explain-tracking-indexes.sql — índices só são
-- validados (e permanecem) com plano verificado no banco real.
-- ============================================================

-- ── 1. Índices compostos de tracking_events ──
-- Cobrem as ~30 consultas de dashboard/report com padrão
-- siteId + janela (createdAt) e siteId + eventType + janela.
-- Com siteId NULL (visão "todos os sites"), o índice simples
-- "createdAt" (baseline) cobre — sem mudança de plano pior.
CREATE INDEX IF NOT EXISTS "tracking_events_siteId_createdAt_idx" ON "tracking_events"("siteId", "createdAt");

CREATE INDEX IF NOT EXISTS "tracking_events_siteId_eventType_createdAt_idx" ON "tracking_events"("siteId", "eventType", "createdAt");

-- ── 2. Índice composto de tracking_visitors ──
-- Top países/cidades/dispositivos filtram lastSeenAt + siteId.
CREATE INDEX IF NOT EXISTS "tracking_visitors_siteId_lastSeenAt_idx" ON "tracking_visitors"("siteId", "lastSeenAt");

-- ── 3. Tabela do rate limit distribuído ──
-- UMA linha por chave (ip); a janela corrente é resetada pelo próprio
-- statement do endpoint (CASE no ON CONFLICT). Sem FK/relacionamento —
-- infraestrutura de proteção, não dado de negócio.
CREATE TABLE IF NOT EXISTS "tracking_rate_limit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracking_rate_limit_pkey" PRIMARY KEY ("key")
);
