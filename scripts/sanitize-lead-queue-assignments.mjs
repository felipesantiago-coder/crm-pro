#!/usr/bin/env node
// ============================================================
// Fase 4 da otimização Vercel — SANEAMENTO de atribuições de fila
// duplicadas (LeadQueueAssignment.leadId), PRÉ-REQUISITO da
// migration 20260911_lead_queue_assignment_unique.
//
// Por que existe: a criação via assignLeadToUser era protegida por
// dedup de 2 camadas (cache em memória + findFirst), mas corridas
// raras (webhook + polling simultâneos do mesmo lead antes da inbox,
// chamadas diretas ao endpoint /api/lead-queues/assign) podiam criar
// 2 linhas para o mesmo lead. O CREATE UNIQUE INDEX da migration
// FALHA se houver duplicado — este saneamento roda ANTES.
//
// Política (conservadora, sem mudança de comportamento observável):
//   - Mantém a linha MAIS RECENTE por leadId
//     (ORDER BY "createdAt" DESC, "id" DESC) — é exatamente a linha
//     que o dedup em runtime retorna hoje (findFirst orderBy
//     createdAt desc), então nenhuma UI/fluxo muda de dono.
//   - Remove as mais antigas APENAS com backup.
//
// Backup: tabela lead_queue_assignments_dup_backup_<timestamp> no
// próprio banco (restaurável por INSERT ... SELECT) + arquivo JSON
// quando --output for informado.
//
// Uso:
//   DRY RUN (padrão, não escreve nada):
//     DATABASE_URL="postgresql://...5432..." node scripts/sanitize-lead-queue-assignments.mjs
//   APLICAR:
//     DATABASE_URL="..." node scripts/sanitize-lead-queue-assignments.mjs --apply
//   APLICAR + exportar backup JSON:
//     DATABASE_URL="..." node scripts/sanitize-lead-queue-assignments.mjs --apply --output backup-dup.json
//
// Idempotente: pode rodar quantas vezes quiser — reexecução limpa
// informa 0 duplicados. É o MESMO algoritmo do Bloco 1 do pacote
// download/fase4-sql-editor-release.sql (SQL Editor do Supabase).
//
// Pooler: usar URL de SESSÃO (porta 5432) — a transação é curta
// (backup + delete), compatível também com 6543, mas 5432 é o padrão
// dos releases (docs/rollback.md §2).
// ============================================================

import { Client } from 'pg';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const OUT_IDX = args.indexOf('--output');
const OUTPUT_FILE = OUT_IDX !== -1 ? args[OUT_IDX + 1] : null;
const BACKUP_TABLE = 'lead_queue_assignments_dup_backup_20260911';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✖ DATABASE_URL obrigatória (postgresql://... — sessão 5432 em produção)');
  process.exit(1);
}
if (/^file:/.test(DATABASE_URL)) {
  console.error('✖ Este saneamento é para o Postgres de produção — DATABASE_URL sqlite recebida');
  process.exit(1);
}

const client = new Client({ connectionString: DATABASE_URL });

const REPORT_SQL = `
  SELECT a."leadId",
         COUNT(*)::int AS total,
         MIN(a."createdAt") AS mais_antiga,
         MAX(a."createdAt") AS mais_recente
  FROM lead_queue_assignments a
  WHERE a."leadId" IS NOT NULL
  GROUP BY a."leadId"
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC, a."leadId"
`;

// Linhas que SERÃO removidas (todas menos a mais recente por leadId)
const LOSERS_SQL = `
  SELECT ranked.id, ranked."leadId", ranked."queueId", ranked."userId",
         ranked.source, ranked."createdAt"
  FROM (
    SELECT a2.id, a2."leadId", a2."queueId", a2."userId", a2.source, a2."createdAt",
           ROW_NUMBER() OVER (
             PARTITION BY a2."leadId"
             ORDER BY a2."createdAt" DESC, a2."id" DESC
           ) AS rn
    FROM lead_queue_assignments a2
    WHERE a2."leadId" IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
  ORDER BY ranked."leadId", ranked."createdAt" ASC
`;

try {
  await client.connect();

  const { rows: dups } = await client.query(REPORT_SQL);
  console.log(`── Relatório de duplicados (leadId com >1 atribuição) ──`);
  if (dups.length === 0) {
    console.log('✔ Nenhum duplicado — banco pronto para a migration');
    process.exit(0);
  }
  for (const d of dups) {
    console.log(
      `  leadId=${d.leadId}  total=${d.total}  mais_antiga=${d.mais_antiga?.toISOString?.() ?? d.mais_antiga}  mais_recente=${d.mais_recente?.toISOString?.() ?? d.mais_recente}`
    );
  }

  const { rows: losers } = await client.query(LOSERS_SQL);
  console.log(`\n── Linhas a remover (mantendo a MAIS RECENTE por leadId): ${losers.length} ──`);
  for (const l of losers) {
    console.log(
      `  remover id=${l.id}  leadId=${l.leadId}  userId=${l.userId}  queueId=${l.queueId}  createdAt=${l.createdAt?.toISOString?.() ?? l.createdAt}`
    );
  }

  if (!APPLY) {
    console.log('\n⏸ DRY RUN — nada foi alterado. Para aplicar: --apply (backup automático na tabela ' + BACKUP_TABLE + ')');
    process.exit(2); // código 2 = duplicados encontrados (não é erro de execução)
  }

  await client.query('BEGIN');

  // Backup das linhas a remover (mesma consulta dos losers)
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${BACKUP_TABLE}" AS
    SELECT * FROM lead_queue_assignments WHERE false
  `);
  await client.query(`
    INSERT INTO "${BACKUP_TABLE}"
    SELECT a.* FROM lead_queue_assignments a
    WHERE a.id IN (
      SELECT ranked.id FROM (
        SELECT a2.id, ROW_NUMBER() OVER (
          PARTITION BY a2."leadId" ORDER BY a2."createdAt" DESC, a2."id" DESC
        ) AS rn
        FROM lead_queue_assignments a2
        WHERE a2."leadId" IS NOT NULL
      ) ranked WHERE ranked.rn > 1
    )
  `);

  const del = await client.query(`
    DELETE FROM lead_queue_assignments
    WHERE "leadId" IS NOT NULL
      AND "id" IN (
        SELECT ranked.id FROM (
          SELECT a2.id, ROW_NUMBER() OVER (
            PARTITION BY a2."leadId" ORDER BY a2."createdAt" DESC, a2."id" DESC
          ) AS rn
          FROM lead_queue_assignments a2
          WHERE a2."leadId" IS NOT NULL
        ) ranked WHERE ranked.rn > 1
      )
  `);

  await client.query('COMMIT');
  console.log(`\n✔ ${del.rowCount} linha(s) removida(s); backup em "${BACKUP_TABLE}"`);

  if (OUTPUT_FILE && losers.length > 0) {
    writeFileSync(OUTPUT_FILE, JSON.stringify({ backupTable: BACKUP_TABLE, removed: losers }, null, 2));
    console.log(`✔ Cópia JSON: ${OUTPUT_FILE}`);
  }

  // Verificação pós-limpeza
  const { rows: after } = await client.query(REPORT_SQL);
  console.log(after.length === 0 ? '✔ Verificação final: 0 duplicados' : `✖ AINDA HÁ ${after.length} duplicados!`);
  process.exit(after.length === 0 ? 0 : 1);
} catch (err) {
  console.error('✖ Falha no saneamento:', err instanceof Error ? err.message : err);
  try { await client.query('ROLLBACK'); } catch {}
  process.exit(1);
} finally {
  try { await client.end(); } catch {}
}
