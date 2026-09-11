#!/usr/bin/env node
// ============================================================
// Fase 6 da otimização Vercel — RETENÇÃO CONFIGURÁVEL da inbox
// (meta_lead_inbox) e do rate limit (tracking_rate_limit).
//
// Por que existe (promessa da Fase 3): "Retenção da inbox:
// SUCCEEDED permanecem (ledger de idempotência/fonte de replay).
// Limpeza configurável fica para a Fase 6". Este script é a limpeza
// CONFIGURÁVEL — manual, explícita e conservadora.
//
// Regras do prompt (Fase 6): "avalie rollups/retenção configuráveis
// SEM APAGAR DADOS SEM CONSENTIMENTO". Por isso:
//   - NADA é apagado automaticamente (nenhum cron, nenhum default ON);
//   - DRY RUN é o padrão (só reporta);
//   - --apply é explícito e por vez;
//   - SÓ remove itens SUCCEEDED (o ledger de replay de itens em
//     falha/pendentes permanece intacto);
//   - retenção de tracking_events é APENAS REPORTADA (decisão
//     documentada em docs/vercel-optimization.md — sem DELETE).
//
// Uso:
//   DRY RUN (padrão, não escreve nada):
//     DATABASE_URL="postgresql://...5432..." node scripts/meta-inbox-retention.mjs
//   APLICAR (inbox + rate limit):
//     DATABASE_URL="..." node scripts/meta-inbox-retention.mjs --apply
//   Dias de retenção (default 30):
//     META_INBOX_RETENTION_DAYS=60 DATABASE_URL="..." node scripts/meta-inbox-retention.mjs --apply
//
// Idempotente. Recomendação: rodar 1×/mês manualmente ou via cron
// EXTERNO agendado pelo usuário (nunca pelo build — regra da Fase 1).
// Pooler: usar URL de SESSÃO (porta 5432) — statements curtos.
// ============================================================

import { Client } from 'pg';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RETENTION_DAYS = Number.parseInt(process.env.META_INBOX_RETENTION_DAYS || '30', 10);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('✖ DATABASE_URL ausente — informe a URL de sessão (5432) de produção.');
  process.exit(2);
}
if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS < 7) {
  console.error('✖ META_INBOX_RETENTION_DAYS inválido — mínimo conservador: 7 dias.');
  process.exit(2);
}

const client = new Client({ connectionString: DATABASE_URL });

async function main() {
  await client.connect();
  console.log(`── Retenção meta_lead_inbox: SUCCEEDED com finishedAt < now() - ${RETENTION_DAYS} dias ──`);

  // 1. Panorama da inbox
  const overview = await client.query(
    `SELECT status, COUNT(*)::int AS n FROM meta_lead_inbox GROUP BY status ORDER BY status`,
  );
  console.log('Panorama da inbox:');
  for (const row of overview.rows) {
    console.log(`  ${row.status.padEnd(12)} ${row.n}`);
  }

  // 2. O que seria removido (SUCCEEDED antigos APENAS)
  const eligible = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM meta_lead_inbox
      WHERE status = 'SUCCEEDED'
        AND "nextAttemptAt" IS NOT NULL
        AND "nextAttemptAt" < now() - ($1 || ' days')::interval`,
    [RETENTION_DAYS],
  );
  const toDelete = eligible.rows[0]?.n ?? 0;
  console.log(`SUCCEEDED elegíveis para remoção (nextAttemptAt < ${RETENTION_DAYS}d): ${toDelete}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nada foi removido. Para aplicar: --apply');
    console.log('Sempre com backup prévio (pg_dump da tabela) se o ledger for importante.');
  } else {
    const del = await client.query(
      `DELETE FROM meta_lead_inbox
        WHERE status = 'SUCCEEDED'
          AND "nextAttemptAt" IS NOT NULL
          AND "nextAttemptAt" < now() - ($1 || ' days')::interval`,
      [RETENTION_DAYS],
    );
    console.log(`\n--apply: ${del.rowCount} item(ns) SUCCEEDED removido(s) da inbox.`);
    console.log('Itens RECEIVED/PROCESSING/RETRYABLE/FAILED PRESERVADOS (ledger de falha).');
  }

  // 3. tracking_rate_limit — linhas paradas são lixo puro (contador
  //    de janela); limpeza aqui é completa (o endpoint também limpa
  //    de forma oportunista a cada ~5% dos requests)
  if (APPLY) {
    const delRl = await client.query(
      `DELETE FROM tracking_rate_limit WHERE "windowStart" < now() - interval '1 hour'`,
    );
    console.log(`tracking_rate_limit: ${delRl.rowCount} linha(s) de janelas antigas removida(s).`);
  } else {
    const rl = await client.query(
      `SELECT COUNT(*)::int AS n FROM tracking_rate_limit WHERE "windowStart" < now() - interval '1 hour'`,
    );
    console.log(`tracking_rate_limit parado (>1h): ${rl.rows[0]?.n ?? 0} linha(s) — removidas no --apply.`);
  }

  // 4. Retenção de tracking_events — SOMENTE RELATÓRIO (decisão da
  //    Fase 6: sem DELETE automático; dados de terceiros precisam de
  //    consentimento/base legal antes de qualquer descarte)
  const te = await client.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE "createdAt" < now() - interval '90 days')::int AS older_than_90d,
       COUNT(*) FILTER (WHERE "createdAt" < now() - interval '180 days')::int AS older_than_180d
     FROM tracking_events`,
  );
  const r = te.rows[0] ?? {};
  console.log('\n── tracking_events (RELATÓRIO — NENHUM dado é removido) ──');
  console.log(`  total: ${r.total ?? 0} | >90d: ${r.older_than_90d ?? 0} | >180d: ${r.older_than_180d ?? 0}`);
  console.log('  Decisão da Fase 6: retenção de tracking_events fica sob decisão do titular dos dados;');
  console.log('  não há DELETE automático. Rollups são desnecessários no volume atual (cache 60s + índices).');
}

main()
  .then(() => client.end())
  .catch(async (err) => {
    console.error('✖', err?.message ?? err);
    try { await client.end(); } catch {}
    process.exit(1);
  });
