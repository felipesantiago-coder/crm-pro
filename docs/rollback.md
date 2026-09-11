# Rollback e Procedimento de Release — CRM Pro

**Data:** 2026-09-11 · Complemento de `docs/vercel-optimization.md`

## 1. Visão geral

| Mudança | Como reverter | Risco |
|---|---|---|
| `outputFileTracingExcludes` (typescript) | Remover o bloco de `next.config.ts` e pushar | Nenhum — só re-adiciona 18,9 MB |
| `supabase-server.ts` lazy | `git revert` do arquivo (API de import é a mesma) | Nenhum |
| `ignoreBuildErrors: false` | Voltar para `true` em `next.config.ts` | Baixo — só silencia typecheck de novo |
| Rotas ntfy removidas | Restaurar os 3 route.ts + `lib/ntfy.ts` do histórico | As rotas continuariam quebradas (campos não existem no banco desde 2026-07-29) — recriar campos exigiria migration nova |
| Migration fora do build | Restaurar `node scripts/vercel-migrate.mjs` no script `build` (o teste de higiene `tests/build-hygiene` vai falhar de propósito — é o alarme) | Volta ao comportamento antigo |
| Correções de typecheck | `git revert` arquivo a arquivo — todas são anotações/guards sem mudança de comportamento | Nenhum |
| Migration `20260911_create_whatsapp_landings` | `DROP TABLE "whatsapp_landings";` (tabela isolada, sem FK) | Perde landings criadas |
| Migration `20260911_meta_ingest_durability` (inbox/cursor/lease) | `DROP TABLE IF EXISTS "meta_polling_lease"; DROP TABLE IF EXISTS "meta_polling_cursor"; DROP TABLE IF EXISTS "meta_lead_inbox";` + flags `META_INGEST_V2=legacy` e `META_POLL_CURSOR_V2=legacy` | Sem perda de leads (clients intacto); perde apenas itens pendentes na inbox na hora do drop |
| Migration `20260911_lead_queue_assignment_unique` (Fase 4) | `DROP INDEX IF EXISTS "lead_queue_assignments_leadId_key"; CREATE INDEX IF NOT EXISTS "lead_queue_assignments_leadId_idx" ON "lead_queue_assignments"("leadId");` + flag `LEAD_QUEUE_ATOMIC_V2=legacy` | Sem perda de atribuições; volta ao CAS + create de 2 statements (com replay P2002). O índice simples é recriado pois foi dropado como redundante |

## 2. Procedimento de release de migration (NOVO fluxo)

O build **não** aplica migrations. Uma migration nova segue este fluxo:

```bash
# 1) Commit da migration via ponte (GUARD B garante provider postgresql)
./scripts/push-to-main.sh "feat: migration X" prisma/migrations/<nova>/migration.sql

# 2) Deploy sobe (build não toca no banco — deploy anterior segue no ar até o novo ficar pronto)

# 3) Aplicar UMA VEZ, de ambiente protegido (máquina do Felipe), usando a
#    conexão de SESSÃO do Supabase (porta 5432 — session pooler ou direct):
DATABASE_URL="postgresql://<user>:<pass>@aws-1-<region>.pooler.supabase.com:5432/postgres" \
  npm run db:release

#    (db:release = scripts/vercel-migrate.mjs: converte 6543→5432
#     automaticamente, aplica com timeout e trata drift P3005/P3018
#     com baseline controlado)

# 4) Validar índices novos com EXPLAIN (regra 8):
#    Fase 3:
DATABASE_URL="<url-sessao>" psql "$DATABASE_URL" -f scripts/explain-meta-ingest-indexes.sql
#    Esperado: Index Scan em dedupKey (Q1), (status,nextAttemptAt) (Q2),
#    (adAccountId,formId) (Q3) e scope (Q4). Seq Scan em tabelas
#    populadas → investigar ANTES de liberar o canário.
#
#    Fase 4 (atribuição atômica) — ANTES do passo 3, o saneamento é
#    OBRIGATÓRIO (CREATE UNIQUE INDEX falha com duplicado):
DATABASE_URL="<url-sessao>" node scripts/sanitize-lead-queue-assignments.mjs          # DRY RUN
DATABASE_URL="<url-sessao>" node scripts/sanitize-lead-queue-assignments.mjs --apply  # backup + limpeza
#    (alternativa sem psql/node: SQL Editor do Supabase com os MESMOS
#     passos — saneamento idêntico ao script acima + DDL da migration
#     + registro em _prisma_migrations; pacote pronto em
#     download/fase4-sql-editor-release.sql do ambiente do projeto)
#
#    Depois de aplicada a migration:
#    Fase 4 — EXPLAIN do UNIQUE e do statement atômico:
DATABASE_URL="<url-sessao>" psql "$DATABASE_URL" -f scripts/explain-lead-queue-indexes.sql
#    Esperado: Index Scan em leadId (Q1) e plano da CTE sem erro (Q2).
#    Q2 usa EXPLAIN sem ANALYZE — NÃO executa escrita.

# 5) Verificar
DATABASE_URL="<url-sessao>" npx prisma migrate status
```

- Se o `db:release` falhar, o código novo já no ar deve TOLERAR o schema antigo até a correção (projetar migrations aditivas e código compatível com ambas as versões durante a janela).
- Nunca rodar `db:release` em loop/agendamento — é por release, manual, auditável.
- **Vercel Preview sem banco (recomendado):** Project Settings → Environment Variables → deixar `DATABASE_URL`/`DIRECT_DATABASE_URL` somente no ambiente **Production** (e, se necessário, apontar Preview para um banco sintético). Com o migrate fora do build, previews já não escrevem no banco mesmo com as vars herdadas.

## 3. Verificação de integridade pós-release

```bash
npm test        # 648/648 (inclui higiene do build + lead-queue)
npm run typecheck
npm run lint    # 11 err / 4 warn = baseline inalterado
```

## 4. Rollback de deploy na Vercel

- Dashboard → Deployments → **Instant Rollback** para o último deployment saudável (o que estava no ar antes do push problemático).
- Como o build não migra mais, rollback de código NUNCA precisa de rollback de schema para o caso geral. Exceção: reverter uma migration de índice é seguro (DROP INDEX); reverter DROP de coluna exige cuidado com dados criados no intervalo.

## 5. Checklist de canário (24–48 h) — Fase de validação

Comparar antes/depois por deployment no Observability do projeto:

- [ ] Function size por rota (esperado: queda nos bundles que traçavam typescript)
- [ ] Invocações, p50/p95/p99, active CPU, memória (esperado: neutro — nada de runtime mudou)
- [ ] Erros/timeout 5xx (esperado: neutro ou melhor — typecheck agora barra builds quebrados)
- [ ] Fluxo funcional: login, lead via webhook, lead via polling, cartão Telegram, atribuição de fila, landing WhatsApp `/lp/{slug}`, upload de imagem, extração PDF, tracking, publicação aprovada refletindo na próxima visita
- [ ] Sem leads duplicados/perdidos após o deploy

### Canário específico da Fase 3 (ingestão durável)

- [ ] `meta_lead_inbox` recebendo linhas com status transitando RECEIVED → SUCCEEDED (painel do Supabase ou SQL)
- [ ] Webhook: criar lead de teste no formulário → cliente aparece no CRM + cartão Telegram como antes (latência equivalente)
- [ ] Replay do MESMO evento (reenvio do payload) → SEM novo cliente/interação/cartão; resposta com resultado existente
- [ ] Polling: cursor avançando por (conta, formulário); `perForm` com fetched/imported/deduped coerentes; campo novo `inboxDrained` ≥ 0
- [ ] `meta_polling_lease`: linha `scope='polling'` liberada ao fim de cada run (ou expira em 90 s)
- [ ] Endpoint `/api/cron/meta-inbox-drain?limit=10` (com CRON_SECRET) respondendo `{status:'ok',...}` — recomenda-se agendar a cada 1–5 min no cron-job.org
- [ ] Se algo estranho: `META_INGEST_V2=legacy` + `META_POLL_CURSOR_V2=legacy` (redeploy) OU Instant Rollback §4 — degradação para o caminho antigo sem perda (itens pendentes na inbox ficam para depois de reativar)

### Canário específico da Fase 4 (atribuição atômica)

- [ ] Lead via webhook → atribuição criada em `lead_queue_assignments` com round-robin seguindo a ordem dos membros (como antes)
- [ ] Replay do MESMO lead (reenvio/segunda via) → resposta `already_assigned` com o MESMO dono; NENHUMA 2ª linha (UNIQUE)
- [ ] Duas abas/sessões disparando leads ao mesmo tempo → distribuição A→B→C preservada, nenhum membro recebe 2 leads seguidos indevidamente
- [ ] `peekNextUser` das landings mostra o agente da vez (comportamento inalterado)
- [ ] Log `Caminho atômico indisponível — usando CAS+create legado` NÃO aparece em produção (se aparecer: UNIQUE não aplicada ou erro de statement — investigar; o caminho legado mantém o serviço)
- [ ] Se algo estranho: `LEAD_QUEUE_ATOMIC_V2=legacy` (redeploy) OU Instant Rollback §4 — rollback de schema documentado na tabela §1

## 6. Recuperação de desastre — drift de schema (P3005/P3018)

Documentado no cabeçalho de `scripts/vercel-migrate.mjs`; resumo:

```bash
# Baseline manual (db push aditivo + migrate resolve) — SEM --accept-data-loss:
DATABASE_URL="<url-sessao>" npm run db:baseline -- --url "<url-sessao>" --yes
DATABASE_URL="<url-sessao>" npm run db:release
```
