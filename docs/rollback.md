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

# 4) Verificar
DATABASE_URL="<url-sessao>" npx prisma migrate status
```

- Se o `db:release` falhar, o código novo já no ar deve TOLERAR o schema antigo até a correção (projetar migrations aditivas e código compatível com ambas as versões durante a janela).
- Nunca rodar `db:release` em loop/agendamento — é por release, manual, auditável.
- **Vercel Preview sem banco (recomendado):** Project Settings → Environment Variables → deixar `DATABASE_URL`/`DIRECT_DATABASE_URL` somente no ambiente **Production** (e, se necessário, apontar Preview para um banco sintético). Com o migrate fora do build, previews já não escrevem no banco mesmo com as vars herdadas.

## 3. Verificação de integridade pós-release

```bash
npm test        # 586/586 (inclui higiene do build)
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

## 6. Recuperação de desastre — drift de schema (P3005/P3018)

Documentado no cabeçalho de `scripts/vercel-migrate.mjs`; resumo:

```bash
# Baseline manual (db push aditivo + migrate resolve) — SEM --accept-data-loss:
DATABASE_URL="<url-sessao>" npm run db:baseline -- --url "<url-sessao>" --yes
DATABASE_URL="<url-sessao>" npm run db:release
```
