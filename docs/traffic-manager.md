# Gestor de Tráfego — Fase 8 (estágio A + relatório p/ IA externa)

Espelho diário de custo/performance da **Marketing API** da Meta cruzado com o
**resultado real do funil no CRM**, com painel administrativo (aba "Gestor de
Tráfego" no painel Meta Ads) e relatório markdown **sem PII** para análise por
IA externa. Implementação **puramente aditiva** — nenhuma rota, tabela ou
comportamento existente foi alterado.

## Escopo implementado (estágios A + B-no-formato-relatório)

- **Sincronização de insights**: `GET/POST /api/cron/traffic-insights-sync` —
  2 requisições por conta (`level=campaign` e `level=adset`,
  `time_increment=1`) com paging (teto 10 páginas). Auth: sessão ADMIN ou
  `CRON_SECRET` (bearer/query) — mesmo padrão do `meta-inbox-drain`.
- **Painel**: aba "Gestor de Tráfego" — totais (gasto, leads Meta, CPL médio,
  CPA global), badges de saúde do sync por conta e tabela por campanha
  (gasto, leads, CPL, clientes, ganhos, perdidos, CPA, win rate).
- **Relatório p/ IA externa**: `GET /api/traffic/report?days=N` — markdown com
  guardrails de decisão embutidos (significância ≥ 15 leads ou ≥ R$ 100,
  orçamento ±30% por ciclo, learning phase, prioridade a CPA/qualidade).
  Botões copiar/baixar na UI.
- **Dados de resultado**: leads atribuídos por campanha via **join
  estruturado** (`meta_lead_inbox.campaignId` → `clients.metaLeadgenId`,
  estágio/temperatura) + **fonte legada** (regex `Campanha:` do notes, como
  em `/api/meta-ads`) com **dedupe por leadgenId** — o legado conta apenas
  clientes que a inbox não cobre; os dois mapas são **somados** (cobrem
  conjuntos disjuntos de leads).

## Tabelas novas (migration `20260913_traffic_insights`)

| Tabela | Papel |
|---|---|
| `meta_ad_insight_daily` | 1 linha por (conta, nível, entidade, dia) — spend/impressions/clicks/reach/leadsMeta/cpm/cpc/ctr + campaignId/campaignName do pai |
| `meta_ads_sync_state` | Saúde do sync por conta: lastStatus (`never`/`ok`/`partial`/`error`), lastSyncedAt, lastWindowDays, lastError |

Checksum registrado: `6b4fb172c47d5fef09b07691a2e95a7a787809752230ded9e48e23c11f68f329`.

## Tabelas novas da Fase 8.2 (migration `20260913_traffic_entity_state`)

| Tabela | Papel |
|---|---|
| `meta_ad_entity_state` | Estado PONTUAL por entidade (campanha/conjunto): `dailyBudgetMinor`/`lifetimeBudgetMinor` (centavos), `status`, `effectiveStatus`, `learningStage` (só conjunto), `fetchedAt` — espelho de `/campaigns` + `/adsets` |

Checksum registrado: `0557b64900389d468efbfad4a86e57fc4a214aa0be3cd30bebb40672a917d352`.

## Fase 8.2 — relatório nível gestor sênior (implementado)

O relatório (`buildTrafficReportMarkdown`) passou de v1 (custo × resultado) para
análise com as 3 camadas de um media buyer sênior, mantendo ZERO PII:

1. **Topo de funil (diagnóstico criativo × leilão)** — somas de impressões,
   cliques e alcance + derivados calculados dos SOMAS (nunca média das linhas
   diárias): CTR, CPM, frequência. CTR baixo → criativo; CPM alto → público/leilão.
2. **Qualidade e meio de funil (CRM)** — temperatura (quente/morno/frio) e
   contadores de funil atingido: `agendados` (VISITA_AGENDADA+), `visitas`
   (VISITA_REALIZADA+), `propostas` (CARTA_PROPOSTA+). Aproximação monotônica
   documentada: estágio é o ATUAL do cliente; fechados contam como tendo passado
   por todas as etapas. Indicador de gargalo, não número exato.
3. **Pulso da janela** — `dias ativos` (dias UTC com gasto > 0; amostra curta
   engana significância) e `tendência CPL` (1ª vs 2ª metade da janela; limiar
   ±10%; `sem_base` quando uma metade não tem leads).
4. **Estado de entrega e orçamentos (8.2b)** — tabela com orçamento diário em
   BRL (centavos/100), status, entrega e learning por entidade. O guardrail nº 5
   passa a pedir recomendação em valor ABSOLUTO quando o orçamento está na
   tabela; guardrail nº 2 manda NÃO editar conjunto em `LEARNING`.

O sync (`/api/cron/traffic-insights-sync`) ganhou 2 requisições por conta
(`/campaigns` + `/adsets`, mesmo token `ads_read`, paging com teto) e o
snapshot-replace do estado é por CONTA inteira. Rollback granular:
`TRAFFIC_ENTITY_STATE_V2=legacy` desliga SÓ essa coleta. Sem a tabela
(SQL pendente), o relatório omite a seção e tudo o mais funciona (degrade P2021).

## Decisões de desenho (explícitas)

1. **Snapshot-REPLACE por janela** (deleteMany + createMany em transação):
   a Meta retrocorrige atribuição; re-sincronizar SOBRESCREVE os dias da
   janela em vez de duplicar. A UNIQUE composta
   `(adAccountId, level, entityId, date)` é rede de segurança.
2. **`leadsMeta` = MAX** entre os `action_types` de lead (`lead`,
   `onsite_conversion.lead_grouped`) — NUNCA soma (evita dupla contagem de
   métricas sobrepostas da Meta).
3. **Token por conta** (`meta_ad_accounts.accessToken`), o mesmo do polling
   de leads. Requer **`ads_read`** no token. **Sem app review**: System User
   no Business Manager com a conta atribuída gera token sem expiração sem
   qualquer revisão (review só seria exigida para clientes finais conectando
   as próprias contas — multi-tenant).
4. **Erros de auth (Graph 190/200/10) marcam** `authStatus`/`lastAuthError`
   da conta (mesmo modelo do OAuth/diagnóstico) — best-effort, awaited.
5. **Degradación graciosa**: sem as tabelas (SQL pendente), as rotas respondem
   `status:'unavailable'` (200) com WARN único; o resto do CRM segue intacto
   (padrão das fases anteriores).
6. **Sem PII por construção**: a fatia de leitura (`TrafficReadDb`) não
   seleciona name/phone/email de cliente; o relatório contém apenas agregados
   e nomes de campanha/conjunto. Teste dedicado prova a ausência.
7. **Sem flags**: recurso isolado e aditivo; rollback = DROP das tabelas
   (nenhum dado de negócio — espelho reconstruível).

## Operação

- **Cron diário (cron-job.org, 1×/dia)**:
  `https://crm-pro.site/api/cron/traffic-insights-sync?days=7&secret=CRON_SECRET`
  (janela de 7 dias cobre correções retroativas da Meta nos últimos dias).
- **Sync manual**: botão "Sincronizar" na aba (período 7/14/30/60/90 dias —
  clamp 1..60 na rota de sync).
- **Relatório**: botão "Gerar relatório p/ IA" → copiar → colar na IA externa
  com o pedido sugerido no próprio relatório. Registrar as decisões tomadas
  no ciclo anterior melhora as recomendações seguintes (colar o histórico
  junto, se quiser).

## Arquivos

- `prisma/migrations/20260913_traffic_insights/migration.sql` + validador
  `scripts/validate-traffic-migration.sh` (1:1 vs canônico Prisma)
- `prisma/migrations/20260913_traffic_entity_state/migration.sql` + validador
  `scripts/validate-traffic-entity-state.sh` (Fase 8.2, mesmo padrão 1:1)
- `src/lib/traffic-insights.ts` — parser, janela, fetch/paging, sync (insights
  + entity state), agregação custo×funil×topo, pulso temporal, snapshot e
  builder do relatório (puro, DI)
- `src/lib/traffic-defaults.ts` — amarração real ao Prisma (padrão
  meta-ingest/defaults.ts)
- `src/app/api/cron/traffic-insights-sync/route.ts`,
  `src/app/api/traffic/overview/route.ts`,
  `src/app/api/traffic/report/route.ts`
- `src/components/crm/meta-ads/traffic-insights-section.tsx` (+ montagem em
  `meta-ads-panel.tsx`: 1 import, 1 item de aba, 1 TabsContent)
- `tests/traffic-insights/*.test.ts` — 67 testes (suíte total 809/809)
- `download/fase8-sql-editor-release.sql` + `download/fase82-sql-editor-release.sql`
  — pacotes SQL Editor (Blocos 0–4)

## Estágio C (futuro, NÃO implementado)

Automação com guardrails duros (execução de mudanças de orçamento dentro de
limites, kill switch, auditoria completa). A fila de ações pode reusar o
padrão da `meta_lead_inbox` (status/attempts/audit). Nada disso existe hoje
— o estágio atual é somente leitura + recomendação assistida.
