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

## Fases 3/4/6/7 — Sequenciadas (não rejeitadas; exigem janela de release/canário)

| Fase | Escopo | Por que não nesta iteração | Próximo passo |
|---|---|---|---|
| 3 — Ingestão durável (inbox idempotente, cursor por (adAccountId, formId), lease distribuído, quota atômica) | migration + código + testes de replay/concorrência | altera caminho crítico de leads (HMAC→inbox→worker); precisa migration aplicada com janela + canário com métricas 24–48 h; regra 10 exige testes de contrato do comportamento ATUAL antes | (1) testes de contrato webhook/polling; (2) migration inbox/cursor; (3) worker; (4) canário com flags |
| 4 — Atribuição de fila atômica (UNIQUE em LeadQueueAssignment + transação/P2002-replay) | saneamento prévio de duplicados + migration | requer saneamento em produção com backup e EXPLAIN; risco de duplicar atribuições se mal ordenado | ferramenta de saneamento + EXPLAIN + migration com rollback SQL |
| 6 — Tracking/relatórios (limites de lote, rate limit distribuído, índices com EXPLAIN, cache curto) | código + migrations de índice | índices exigem EXPLAIN no banco real (sandbox sem acesso, regra 2) | medir com `DIRECT_DATABASE_URL` de leitura; índices `(siteId, createdAt)`, `(siteId, eventType, createdAt)` |
| 7 — Páginas públicas (snapshot versionado + invalidação por tag), imagens/PDF adaptativos | cache/invalidação + compressão | invalidação exige prova de cobertura por locale/fluxo de publicação; compressão adaptativa exige benchmark de legibilidade | spike de revalidateTag com publish/unpublish + fixture PT/EN/ES |

## Critérios de aceite — status

- ✅ Nenhum build executa migration/baseline (testado por contrato)
- ✅ `npm ci`-equivalente local (instalação limpa existente), geração Prisma isolada, typecheck limpo (postgres), 586/586 testes, build verde sem banco
- ✅ Build sem migration + análise de bundle (−18,9 MB)
- ⏳ Canário 24–48 h com métricas de runtime — **ação do usuário** (dashboard Vercel), checklist em `docs/rollback.md` §5
- ⏳ Fases 3/4/6/7 — sequenciadas (tabela acima)
