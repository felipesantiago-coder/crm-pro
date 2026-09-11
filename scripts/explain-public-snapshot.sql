-- ============================================================
-- EXPLAIN da Fase 7 — snapshot público versionado
-- (enterprise_public_snapshots)
--
-- Compatível com o SQL Editor do Supabase (roda como owner postgres,
-- sem psql). Q1–Q3 são LEITURA (Q2/Q3 usam EXPLAIN puro — sem ANALYZE —
-- portanto NÃO executam o statement e NÃO escrevem).
--
-- Esperado com dados:
--   Q1 (hit do caminho feliz): Index Scan usando
--       enterprise_public_snapshots_slug_locale_key
--   Q2 (invalidação por empreendimento): Index Scan usando
--       enterprise_public_snapshots_enterpriseId_idx
--   Q3 (freshness por request): Index Scan usando enterprises_slug_key
--   Tabelas vazias no release → Seq Scan é NORMAL (o otimizador prefere
--   varredura sequencial sem dados); re-executar após tráfego real.
-- ============================================================

-- Q1 — Caminho feliz do request público: findUnique por (slug, locale).
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "payload", "baseUpdatedAt", "version", "refreshedAt"
FROM "enterprise_public_snapshots"
WHERE "slug" = 'QA_fase7_slug'
  AND "locale" = 'pt-BR'
LIMIT 1;

-- Q2 — Invalidação explícita (tabelas filhas): deleteMany por
-- enterpriseId. EXPLAIN PURO — planeja sem executar (não apaga nada).
EXPLAIN
DELETE FROM "enterprise_public_snapshots"
WHERE "enterpriseId" = 'QA_fase7_enterprise';

-- Q3 — Digital de frescor verificada a CADA request público.
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "updatedAt", "publishedVersion"
FROM "enterprises"
WHERE "slug" = 'QA_fase7_slug'
LIMIT 1;

-- Q4 — Inventário dos índices da tabela nova (2 esperados + PK).
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'enterprise_public_snapshots'
ORDER BY indexname;
