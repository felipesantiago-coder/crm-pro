-- ============================================================
-- EXPLAIN das consultas críticas da Fase 4 (atribuição atômica)
-- Executar UMA vez no release, contra o Postgres de produção
-- (SQL Editor do Supabase ou psql com DIRECT_DATABASE_URL 5432)
-- — regra 8 do prompt: índice só entra/permanece validado por EXPLAIN.
--
-- Expectativas (com dados):
--   Q1: Index Scan using lead_queue_assignments_leadId_key
--       (replay/idempotência por lead — UNIQUE criada pela Fase 4)
--   Q2: plano do statement atômico completo (CTE guard/target/member/
--       adv/ins) — sem erro de sintaxe/privilege e usando os índices
--       de lead_queue_members e o UNIQUE de leadId no guard
--   Q3: Index Scan using lead_queue_assignments_queueId_createdAt_idx
--       (histórico por fila — inalterado)
-- Com as tabelas vazias/pouco populadas o planner pode escolher Seq
-- Scan — normal no release; o essencial é (a) sem erro e (b) os
-- índices existem (Bloco 4 do pacote SQL Editor). Re-execute após os
-- primeiros leads reais.
-- ============================================================

SELECT '── Q1: replay/idempotência por leadId (UNIQUE da Fase 4) ──' AS secao;
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "queueId", "userId", "createdAt"
FROM "lead_queue_assignments"
WHERE "leadId" = 'QA_LEAD_001'
ORDER BY "createdAt" DESC
LIMIT 1;

SELECT '── Q2: statement atômico completo (CTE da Fase 4) ──' AS secao;
EXPLAIN
WITH guard AS (
  SELECT g.lead_id,
         EXISTS (
           SELECT 1 FROM lead_queue_assignments a
           WHERE a."leadId" = g.lead_id
         ) AS already
  FROM (SELECT CAST('QA_LEAD_001' AS text) AS lead_id) g
),
target AS (
  SELECT q.id AS queue_id, q."currentIdx" AS old_idx, g.lead_id
  FROM lead_queues q
  CROSS JOIN guard g
  WHERE q.id = 'QA_QUEUE_001'
    AND q."isActive" = true
    AND g.already = false
),
member AS (
  SELECT t.queue_id, t.old_idx, t.lead_id, picked."userId" AS user_id
  FROM target t
  JOIN LATERAL (
    SELECT am."userId",
           ROW_NUMBER() OVER (ORDER BY am."order" ASC) AS rn,
           COUNT(*) OVER () AS total
    FROM lead_queue_members am
    WHERE am."queueId" = t.queue_id
      AND am."isActive" = true
      AND am."userId" IS NOT NULL
  ) picked ON picked.rn = (t.old_idx % picked.total) + 1
),
adv AS (
  UPDATE lead_queues q
  SET "currentIdx" = q."currentIdx" + 1
  FROM member m
  WHERE q.id = m.queue_id
    AND q."currentIdx" = m.old_idx
  RETURNING q.id
),
ins AS (
  INSERT INTO lead_queue_assignments ("id", "queueId", "userId", "leadId", "source")
  SELECT gen_random_uuid()::text, m.queue_id, m.user_id, m.lead_id, 'QA_EXPLAIN'
  FROM member m
  WHERE EXISTS (SELECT 1 FROM adv)
  ON CONFLICT ("leadId") DO NOTHING
  RETURNING "queueId", "userId"
)
SELECT ins."queueId", ins."userId"
FROM ins
JOIN users u ON u.id = ins."userId";

SELECT '── Q3: histórico por fila (índice inalterado) ──' AS secao;
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "userId", "createdAt"
FROM "lead_queue_assignments"
WHERE "queueId" = 'QA_QUEUE_001'
ORDER BY "createdAt" DESC
LIMIT 20;

-- NOTA: o Q2 com EXPLAIN (sem ANALYZE) NÃO executa o INSERT/UPDATE —
-- só mostra o plano. NUNCA trocar por ANALYZE com parâmetros reais de
-- produção (o statement escreve).
