# Otimização Vercel — CRM Pro (implementação e decisões)

**Data:** 2026-09-11 · **Base:** `9eff674e68d1` · **Prompt:** CRM_Pro_Prompt_GLM_Otimizacao_Vercel_2026-09-11.md · **Auditoria:** CRM_Pro_Auditoria_Vercel_2026-09-11.md

Método: implementação incremental, mensurável e reversível. Nenhuma funcionalidade observável foi alterada. Métricas de runtime Vercel = **não medidas** (ver baseline §5); comparações abaixo são locais e reais.

## Matriz antes/depois (medido)

| Métrica | Antes | Depois | Δ |
|---|---|---|---|
| Artefato final standalone montado | 161,9 MB | **143,0 MB** | **−18,9 MB (−11,7%)** |
| `typescript` no standalone | 18,9 MB (12%) | 0 | peso morto removido |
| Build executa migration/baseline | sim (a cada deploy) | **não** (release explícito) | risco P0 eliminado |
| `typescript.ignoreBuildErrors` | true | **false** | risco P1 eliminado |
| Erros de typecheck (client postgres) | ~89 linhas | **0** | build valida tipos |
| Build local sem envs de Storage | ❌ crash na importação | ✅ verde (54s) | robustez CI/preview |
| Testes | 580/580 | **586/586** | +6 higiene de build |
| Lint | 11 err / 4 warn | 11 err / 4 warn | inalterado |
| Per-function package (sharp/xlsx/pdf-parse) | já segmentado por rota | confirmado (§2) | nenhuma ação necessária |
| Replay de webhook | podia reprocessar (interação+cartão duplicados) | **inbox idempotente por dedupKey** | replay devolve o resultado existente |
| Webhook + polling do mesmo lead | 2 processamentos independentes | **MESMA linha da inbox** | processado UMA vez |
| Leads além da quota do polling (50/run) | PERDIDOS (watermark avançava mesmo assim) | **ficam na inbox** e são importados nos próximos runs/drain | perda de lead eliminada |
| `isRunning` do polling | memória (por instância) | **lease PG com TTL 90s + renovação + recovery** | 2 instâncias não duplicam run |
| Quota do polling | decremento desprotegido (estourava sob concorrência) | **UPDATE condicional atômico** (`quotaRemaining > 0`) | teto respeitado |
| Janela do polling | since + limit=100 (1 página) | **cursor por (adAccountId, formId) + paginação completa** | nenhum lead além de 100 fica para trás |
| Falha no meio do webhook | lead perdido (sem persistência prévia) | **inbox antes do processamento + retry com backoff** | crash = retry, não perda |
| Reserva (avanço do currentIdx) × criação da atribuição | 2 statements separados — crash entre eles avançava a fila SEM atribuir | **UM statement único (CTE data-modifying)** | tudo ou nada; compatível com o pooler (sem transação interativa) |
| Corrida do MESMO lead (webhook/polling/endpoints) | dedup de 2 camadas (cache + findFirst) — janela de corrida criava 2ª atribuição | **UNIQUE(leadId) + replay P2002** | conflito devolve a atribuição existente; nunca duplica |
| Índice simples em `leadId` | mantido junto do novo UNIQUE | **dropado (redundante)** | menos uma escrita de índice por atribuição |

Runtime (invocações, CPU, p95, DB duration): **não medido** — comparar no canário 24–48 h conforme §6.

## Fase 0 — Inventário e baseline ✅

- `docs/vercel-baseline.md` — stack exata, artefatos, decomposição de pacotes, baseline de qualidade, limitações
- `docs/route-inventory.md` — 137 rotas classificadas (98 autenticadas, 14 mídia/PDF, 10 públicas, 6 webhook, 5 auth, 2 relatório, 2 cron) + 12 pages
- Script reutilizável: `scripts/inventory-routes.mjs`

## Fase 1 — Separar build de migration ✅

- `npm run build` = `prisma generate && next build && cp static/public` — **zero conexão/escrita em banco**
- `npm run db:release` = `node scripts/vercel-migrate.mjs` — **comando explícito de release** (conversão 6543→5432, timeout, auto-baseline controlado de drift)
- `npm run db:baseline` mantido como recuperação manual documentada
- `tests/build-hygiene/build-scripts.test.ts` — 6 testes que falham o CI se o build voltar a invocar migrate/db push/baseline (também cobre ganchos de lifecycle)
- Previews: com o migrate fora do build, preview de branch **nunca mais** toca o banco. Recomendação adicional (ação no dashboard Vercel): mover `DATABASE_URL`/`DIRECT_DATABASE_URL` para o escopo **Production** apenas — instruções em `docs/rollback.md`.

### ⚠️ Impacto operacional (importante)

A partir deste commit, **push não aplica migration automaticamente**. Fluxo de schema:

1. Commit da migration (`prisma/migrations/...`) via ponte
2. Deploy sobe (build não migra — seguro)
3. **Uma vez por release com migration**: `DATABASE_URL="<session-pooler-5432>" npm run db:release` (do deploy anterior saudável; ver instruções completas em `docs/rollback.md` §2)

**Verificação pendente:** a migration `20260911_create_whatsapp_landings` foi empurrada às 01:15 com o fluxo antigo (build migrava). Se a criação de landing **ainda** der 500 em produção, rodar o passo 3 acima — não haverá build que a aplique.

## Fase 2 — Qualidade de compilação ✅

- `npm run typecheck` = gate real (`scripts/typecheck.mjs`); `ignoreBuildErrors: false` (build valida; falha = deploy anterior continua no ar)
- 89 linhas de erro → **0 reais** (client postgres); 7 artefatos sqlite documentados em `docs/typecheck-baseline.md` com prova empírica
- Correções detalhadas no baseline doc §4 — destaque: bug real `dow_name`→`day` no relatório; rotas ntfy órfãs (quebradas desde 2026-07-29, sem UI/testes) removidas com decisão documentada

## Fase 5 — Empacotamento ✅ (parcial, com evidência)

- `outputFileTracingExcludes` para `typescript` (nenhum require no grafo traçado — verificado; −18,9 MB comprovados por rebuild)
- `src/lib/supabase-server.ts` lazy (Proxy singleton, mesma API): build verde sem envs de Storage; erro preservado no uso
- Auditoria de imports pesados: **sharp** (2 rotas), **xlsx** (3 rotas), **pdf-parse** (2 libs → 3 rotas) já isolados — nenhum helper compartilhado os puxa; **nenhuma ação** (decisão: manter como está)
- `@prisma` 57,1 MB (35% do artefato): inerente ao engineType atual. **Rejeitado** migrar para `engineType=client`/driver adapter sem benchmark comparativo (vedado pelo prompt; risco de compatibilidade com pooler transacional). Fica para fase com medição real de Function size na Vercel.
- `npm install` → `npm ci`: **rejeitado por enquanto** — exige deploy canário de validação (lockfile ok); reprodutibilidade ganha não justifica risco sem canário. Reavaliar com preview deploy.

## Fase 3 — Ingestão Meta durável e econômica ✅ (implementada; canário pendente)

### O que mudou (4 commits pequenos e reversíveis)

1. **Pipeline unificado** (`src/lib/meta-ingest/pipeline.ts`): o processamento por-lead do webhook (913 linhas inline) e do polling (duplicado com textos/ordem de dedup próprios) foi extraído VERBATIM para um único módulo com injeção de dependências (`MetaIngestServices` — db fatia estrutural + serviços testáveis). Contratos de canal preservados byte a byte e fixados por 15 testes de contrato (regra 10): dedup telefone/email→leadgen no webhook, leadgen→telefone/email no polling; textos `[Meta Ads]`/`[Meta Polling]`; notas com `Criado em` só no polling; cartão SEM empreendimento no webhook e COM clientId no polling; `create_failed` terminal no webhook vs PROPAGA no polling; fallback `Desconhecido`/`?` no aviso de fila.
2. **Inbox idempotente** (`prisma/migrations/20260911_meta_ingest_durability` — tabela `meta_lead_inbox`): webhook persiste o evento (dedupKey `leadgen:{leadgenId}`) ANTES do processamento, responde rápido e processa via worker com orçamento de 20s (maxDuration 30). Status RECEIVED → PROCESSING → SUCCEEDED / RETRYABLE (backoff exponencial, teto 15min, máx 5 tentativas) / FAILED; `lastError` sempre sanitizado (tokens/emails/telefones removidos, ≤500 chars). Replay do mesmo evento devolve o resultado existente — nunca cria cliente (UNIQUE `clients.metaLeadgenId`), atribuição (idempotência de 2 camadas no `assignLeadToUser`) ou mensagem Telegram (delivery-slot).
3. **Polling durável** (tabelas `meta_polling_cursor` + `meta_polling_lease`): cursor persistente por (adAccountId, formId) com backfill do watermark legado; paginação COMPLETA da Graph (paging.next, orçamento de 7,5s/teto 10 páginas); lease distribuído (scope 'polling', TTL 90s, renovação por alvo, release no fim, recovery automático pós-crash); quota de 50 reservada ATOMICAMENTE por lead (`UPDATE ... WHERE quotaRemaining > 0`) com refund em dedup/falha. **Correção real de perda de leads**: leads além da quota hoje eram PERDIDOS (watermark avançava mesmo assim); agora ficam RECEIVED na inbox e são importados automaticamente.
4. **Drain endpoint** (`/api/cron/meta-inbox-drain`, maxDuration 60, lotes de 10–25, auth ADMIN/CRON_SECRET): worker de consumo da fila entre runs — recomenda-se agendar a cada 1–5 min.

### Flags de canário (default ON; rollback por env)

- `META_INGEST_V2=legacy` → webhook volta ao processamento inline (sem inbox)
- `META_POLL_CURSOR_V2=legacy` → polling volta a watermarks soltas + isRunning + quota em memória
- Degradação AUTOMÁTICA: sem migration aplicada (tabela ausente), inbox/cursor/lease falham de forma controlada e o caminho legado assume — deploy seguro ANTES do `db:release`
- Espelho dos cursors nos watermarks legados durante o canário: voltar para legacy não refaz janelas antigas

### Decisões explícitas (regra do prompt)

- **Outbox de Telegram NÃO implementada nesta fase**: a deduplicação já existe no serviço de notificação (delivery-slot por dedupKey) e a inbox cobre o replay — outbox duplicaria mecanismo sem demanda medida. Revisitada só se o canário mostrar perda de cartões.
- **Retenção da inbox**: SUCCEEDED permanecem (ledger de idempotência/fonte de replay). Limpeza configurável fica para a Fase 6 (rollups/retenção), evitando apagar evidência antes do canário.
- **Exceção → RETRYABLE; outcome terminal → SUCCEEDED**: falhas de negócio (`no_user`, `no_account_token`, `create_failed`) são terminais como hoje; retry só em exceções (infra), onde o dedup é à prova de duplicação (leadgen único + idempotência de fila/Telegram). Duplicidade de interação possível apenas no caso raro de exceção ENTRE create e interação — documentado.
- **EXPLAIN pendente de execução**: sandbox sem Postgres (regra 2) — `scripts/explain-meta-ingest-indexes.sql` vai no §2 do rollback.md como passo OBRIGATÓRIO do release.

## Fase 4 — Atribuição de fila atômica ✅ (implementada; release + canário pendentes)

### O que mudou

1. **Migration `20260911_lead_queue_assignment_unique`** — UNIQUE em `lead_queue_assignments."leadId"` (a atribuição lógica de um lead é única; múltiplos NULL continuam válidos para rounds sem lead) + DROP do índice simples `leadId_idx` (redundante — o UNIQUE cobre as mesmas consultas). DDL validado contra o canônico Prisma (`scripts/validate-lead-queue-migration.sh`); rollback SQL no cabeçalho e em `docs/rollback.md` §1.
2. **Saneamento PRÉVIO obrigatório** (`scripts/sanitize-lead-queue-assignments.mjs` + Bloco 1 do pacote SQL Editor): duplicados históricos (corridas pré-inbox) impedem o CREATE UNIQUE INDEX. Política conservadora: mantém a linha MAIS RECENTE por leadId (`createdAt DESC, id DESC`) — exatamente a que o dedup em runtime retorna hoje (`findFirst orderBy createdAt desc`), então NENHUM dono visível muda; remove as antigas com backup em tabela `lead_queue_assignments_dup_backup_20260911` (+ JSON opcional `--output`). DRY RUN por padrão, idempotente.
3. **Statement atômico** (`src/lib/lead-queue.ts` — `atomicAssignLead`): reserva (CAS no `currentIdx`) e criação da atribuição agora são UM ÚNICO statement (CTE data-modifying: `guard → target → member → adv → ins`), exigido pelo prompt ("transação curta/função SQL compatível com o pooler") — sem transação interativa (proibida em `src/lib/db.ts` para PgBouncer), sem conexão direta por request. Crash entre reserva e criação fica impossível por construção; corridas de UPDATE são resolvidas pela reavaliação do WHERE (lock da linha) e pelo índice UNIQUE.
4. **Replay em TODAS as camadas**: conflito P2002 no create do caminho LEGADO também vira replay (devolve a atribuição existente em vez de propagar erro) — exigência do prompt. O replay usa a MESMA semântica do dedup atual (`findFirst orderBy createdAt desc` + `message: 'already_assigned'`).
5. **Ordem/filas preservados (regra do prompt)**: round-robin com `%` sobre membros ativos com usuário (filtragem defensiva equivalente ao skip-loop legado), prioridade fila por campanha/formulário/conta (`resolveQueueForMetaLead` intocado), `peekNextUser` e `setNextUser` inalterados; contratos de mensagem (`'Nenhuma fila ativa encontrada'`, `'Nenhum membro ativo na fila'`, `'Fila não encontrada ou desativada'`, `'Erro interno na atribuição'`), `source` default `'api'` com corte 200 e cache Layer-1 preservados byte a byte.

### Flags de canário (default ON; rollback por env)

- `LEAD_QUEUE_ATOMIC_V2=legacy` → volta ao CAS + create de 2 statements (com replay P2002 — correção da Fase 4 permanece no legado)
- Degradação AUTOMÁTICA: erro no statement (UNIQUE ainda não aplicada → "no unique or exclusion constraint", dialeto sqlite no dev) → caminho legado assume com WARN único — deploy seguro ANTES da migration/saneamento

### Decisões explícitas (regra do prompt)

- **CTE data-modifying em vez de transação interativa**: a convenção do projeto (`src/lib/db.ts`) proíbe `$transaction` interativo com PgBouncer; o prompt permite "função SQL compatível com o pooler" — um statement único é atômico por definição e passa pelo pooler sem fixar conexão. Testado por 18 testes de contrato com fakes que implementam a semântica real (UNIQUE/CAS/CTE) e sintaxe validada por parse Postgres (sqlglot) + EXPLAIN no release (regra 8, sandbox sem Postgres).
- **Saneamento mantém a linha mais RECENTE** (não a mais antiga): o dedup em runtime sempre retornou a atribuição mais recente como dono — manter a mais antiga MUDARIA o dono visível. Backup completo antes de remover.
- **DROP do índice simples**: `lead_queue_assignments_leadId_idx` é coberto pelo UNIQUE `leadId_key` (mesma coluna, mesma capacidade de lookup) — manter ambos seria escrita dupla. Rollback recria o simples (documentado).
- **Legado permanece verbatim** como fallback (flag + degradação), com o acréscimo do replay P2002 — mesmo padrão da Fase 3.
- **EXPLAIN pendente de execução**: `scripts/explain-lead-queue-indexes.sql` (Q1 replay/UNIQUE, Q2 plano do statement atômico — SEM ANALYZE, não escreve, Q3 histórico por fila) vai como passo do release.

## Fases 6/7 — Sequenciadas (não rejeitadas; exigem janela de release/canário)

| Fase | Escopo | Por que não nesta iteração | Próximo passo |
|---|---|---|---|
| 6 — Tracking/relatórios (limites de lote, rate limit distribuído, índices com EXPLAIN, cache curto) | código + migrations de índice | índices exigem EXPLAIN no banco real (sandbox sem acesso, regra 2) | medir com `DIRECT_DATABASE_URL` de leitura; índices `(siteId, createdAt)`, `(siteId, eventType, createdAt)` |
| 7 — Páginas públicas (snapshot versionado + invalidação por tag), imagens/PDF adaptativos | cache/invalidação + compressão | invalidação exige prova de cobertura por locale/fluxo de publicação; compressão adaptativa exige benchmark de legibilidade | spike de revalidateTag com publish/unpublish + fixture PT/EN/ES |

## Critérios de aceite — status

- ✅ Nenhum build executa migration/baseline (testado por contrato)
- ✅ `npm ci`-equivalente local (instalação limpa existente), geração Prisma isolada, typecheck limpo (postgres), 586/586 testes, build verde sem banco
- ✅ Build sem migration + análise de bundle (−18,9 MB)
- ✅ Fase 3: 44 testes novos (contrato 15, inbox 11, webhook-inbox 6, polling 12) — **630/630**; tsc postgres 100% limpo; build Vercel-fiel verde; lint 11/4 = baseline
- ✅ Fase 4: 18 testes novos (tests/lead-queue — replay, 20 concorrentes mesmo lead, 20 leads distintos, falhas entre etapas, flag legacy, CAS perdido, P2002→replay) — **648/648**; tsc postgres 100% limpo; build Vercel-fiel verde; lint 11/4 = baseline; DDL validado vs canônico; CTE validado por parse Postgres
- ⏳ Canário 24–48 h com métricas de runtime + checklists das Fases 3 e 4 — **ação do usuário** (dashboard Vercel), checklists em `docs/rollback.md` §5
- ⏳ Passos do release da Fase 3: `db:release` + `EXPLAIN` (`scripts/explain-meta-ingest-indexes.sql`) — `docs/rollback.md` §2
- ⏳ Passos do release da Fase 4: SANEAMENTO (obrigatório, antes) + `db:release` + `EXPLAIN` (`scripts/explain-lead-queue-indexes.sql`) — `docs/rollback.md` §2; alternativa SQL Editor do Supabase: pacote de release entregue no ambiente do projeto (mesmos passos/sanamento/DDL/registro)
- ⏳ Fases 6/7 — sequenciadas (tabela acima)
