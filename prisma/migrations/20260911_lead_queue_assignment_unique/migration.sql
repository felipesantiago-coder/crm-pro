-- ============================================================
-- Fase 4 da otimização Vercel — atribuição de fila atômica
--
-- Propósito:
--   UNIQUE em lead_queue_assignments."leadId" = a atribuição lógica
--   de um lead é única. Com isso:
--     - corrida webhook/polling/endpoints do MESMO lead não duplica
--       atribuição (conflito vira REPLAY: devolve a linha existente);
--     - a reserva (avanço do currentIdx) e a criação da atribuição
--       passam a ser UM statement único (CTE data-modifying) em
--       assignLeadToUser — crash entre etapas não avança a fila sem
--       atribuir (nem atribui sem avançar).
--   O índice simples lead_queue_assignments_leadId_idx (não único)
--   é DROPADO: o UNIQUE cobre as mesmas consultas (mesma coluna) —
--   menos uma escrita de índice por atribuição.
--
-- PRÉ-REQUISITO OBRIGATÓRIO: saneamento de duplicados ANTES desta
-- migration (CREATE UNIQUE INDEX falha se houver leadId duplicado).
--   Ferramenta: scripts/sanitize-lead-queue-assignments.mjs
--   Bloco SQL Editor: download/fase4-sql-editor-release.sql (Bloco 1)
--   Mantém a linha MAIS RECENTE por leadId (mesma semântica do dedup
--   em runtime: findFirst orderBy createdAt desc) e faz backup.
--
-- Gestão: `prisma migrate deploy` (npm run db:release) ou SQL Editor
--   (download/fase4-sql-editor-release.sql) — NUNCA db push.
-- Idempotente: IF NOT EXISTS / IF EXISTS.
--
-- Rollback (sem perda de atribuições — volta ao comportamento anterior):
--   DROP INDEX IF EXISTS "lead_queue_assignments_leadId_key";
--   CREATE INDEX IF NOT EXISTS "lead_queue_assignments_leadId_idx"
--     ON "lead_queue_assignments"("leadId");
--   (após rollback, definir LEAD_QUEUE_ATOMIC_V2=legacy para o código
--    voltar ao CAS + create de 2 statements)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS "lead_queue_assignments_leadId_key" ON "lead_queue_assignments"("leadId");

DROP INDEX IF EXISTS "lead_queue_assignments_leadId_idx";

