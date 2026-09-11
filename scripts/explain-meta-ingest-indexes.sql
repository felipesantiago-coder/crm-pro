-- ============================================================
-- EXPLAIN das consultas críticas da Fase 3 (inbox/cursor/lease)
-- Executar UMA vez no release, contra o Postgres de produção,
-- com o pooler de SESSÃO (porta 5432) — regra 8 do prompt:
-- índice só entra/permance validado por EXPLAIN.
--
-- Uso:
--   DIRECT_DATABASE_URL="postgresql://...:5432/postgres" \
--     psql "$DIRECT_DATABASE_URL" -f scripts/explain-meta-ingest-indexes.sql
--
-- Expectativas:
--   Q1: Index Scan using meta_lead_inbox_dedupKey_key (unique —
--       garantia de idempotência O(1) no replay)
--   Q2: Index Scan using meta_lead_inbox_status_nextAttemptAt_idx
--       (varredura do drain: pendentes/vencidos primeiro)
--   Q3: Index Scan using meta_polling_cursor_adAccountId_formId_key
--       (cursor por (conta, formulário))
--   Q4: Index Scan using meta_polling_lease_scope_key
--       (aquisição/renovação do lock distribuído)
-- Se qualquer consulta mostrar Seq Scan com plano ruim em tabelas
-- populadas, investigate ANTES de liberar o tráfego canário.
-- ============================================================

\echo '── Q1: idempotência por dedupKey (ensureInboxItem) ──'
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "status", "result"
FROM "meta_lead_inbox"
WHERE "dedupKey" = 'leadgen:QA_EXEMPLO_001'
LIMIT 1;

\echo '── Q2: varredura do drain (pendentes/vencidos) ──'
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "channel", "attempts"
FROM "meta_lead_inbox"
WHERE "status" IN ('RECEIVED', 'RETRYABLE')
  AND "nextAttemptAt" <= now()
ORDER BY "nextAttemptAt" ASC
LIMIT 10;

\echo '── Q3: cursor por (adAccountId, formId) ──'
EXPLAIN (ANALYZE, BUFFERS)
SELECT "cursorTime", "lastConfirmedLeadgenId"
FROM "meta_polling_cursor"
WHERE "adAccountId" = 'QA_ACC' AND "formId" = 'QA_FORM'
LIMIT 1;

\echo '── Q4: lease por escopo (aquisição/renovação) ──'
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "ownerToken", "expiresAt"
FROM "meta_polling_lease"
WHERE "scope" = 'polling'
LIMIT 1;

\echo '── Q5: reserva atômica de quota (UPDATE condicional) ──'
EXPLAIN (ANALYZE)
UPDATE "meta_polling_lease"
SET "quotaRemaining" = "quotaRemaining" - 1, "updatedAt" = now()
WHERE "scope" = 'polling'
  AND "ownerToken" = 'QA_TOKEN'
  AND "quotaRemaining" > 0;
