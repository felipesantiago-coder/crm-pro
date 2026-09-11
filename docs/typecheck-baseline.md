# Typecheck Baseline — CRM Pro

**Data:** 2026-09-11 · **Commit:** `9eff674e68d1` + otimizações Fase 2
**Estado:** `tsc --noEmit` **100% limpo** com o Prisma Client gerado para **postgresql** (provider de produção) — provado por `scripts/prove-postgres-typecheck.sh`. No sandbox, com o provider **sqlite** (dev local), restam **7 artefatos documentados abaixo**, que **não ocorrem na Vercel**.

## 1. Mudança de política

| Antes | Depois |
|---|---|
| `typescript.ignoreBuildErrors: true` — build publicava mesmo com erros de tipo (risco P1 da auditoria) | `ignoreBuildErrors: false` — o build da Vercel **valida os tipos**; falha de tipo = deploy não sobe (o deploy anterior continua no ar) |
| Sem gate local | `npm run typecheck` (scripts/typecheck.mjs) — falha com qualquer erro real; ignora apenas os artefatos documentados |

## 2. Artefatos aceitos (7) — provider sqlite local, válidos em postgres

Filtros `mode: 'insensitive'` existem no Prisma para **PostgreSQL/MongoDB** mas não para **SQLite**. O sandbox usa sqlite (provider de dev); a Vercel gera o client com provider postgresql (conversão feita pelo GUARD B do `push-to-main.sh`), onde esses filtros são válidos e usados em produção hoje.

| # | Arquivo:linha | Erro |
|---|---|---|
| 1 | `src/app/api/enterprises/seed-vitta-info/route.ts:27` | `'mode' does not exist in type 'StringFilter<"Enterprise">'` |
| 2 | `src/app/api/meta-ads/leads/route.ts:84` | idem, `StringNullableFilter<"TrackingEvent">` |
| 3 | `src/app/api/meta-ads/leads/route.ts:85` | idem |
| 4 | `src/app/api/meta-ads/leads/route.ts:86` | idem, `StringFilter<"TrackingEvent">` |
| 5 | `src/app/api/meta-ads/leads/route.ts:220` | idem, `StringFilter<"Client">` |
| 6 | `src/app/api/meta-ads/leads/route.ts:221` | idem, `StringNullableFilter<"Client">` |
| 7 | `src/app/api/users/search/route.ts:31` | idem, `StringFilter<"User">` |

**Proprietário:** Felipe · **Prazo de extinção:** quando o dev local migrar para Postgres (ex.: Supabase local/branch), os erros somem naturalmente e o filtro pode ser removido de `scripts/typecheck.mjs`.

**Não é aceitável** "corrigir" removendo `mode: 'insensitive'`: isso mudaria comportamento (postgres `contains` é case-sensitive) — regressão funcional proibida.

## 3. Prova empírica

```bash
bash scripts/prove-postgres-typecheck.sh
# → gera client postgresql, roda tsc: 0 erros (100% limpo)
# → restaura client sqlite local
```

`next build` da Vercel (client postgres) com `ignoreBuildErrors: false` — validado em simulação local completa (build verde em 54s, sem envs de Storage).

## 4. Erros REAIS corrigidos nesta fase (antes: 89 linhas de erro)

- `src/app/api/auth/[...nextauth]/route.ts` — contrato Next 16: `params` é `Promise` (validator.ts)
- `src/proxy.ts` — `cookies.delete()` com assinatura correta de options
- `src/app/api/enterprises/[id]/route.ts` — guard para `fp.url` null
- `src/app/api/track/debug/route.ts` — `diagnostics.steps` tipado (`string[]`)
- `src/app/api/tracking/report/route.ts` — callback do `unbig` tipado; `dow_name` → `day` (bug de propriedade inexistente)
- **ntfy removido** (3 rotas + `lib/ntfy.ts`): campos `ntfyTopic`/`ntfyToken` foram removidos do schema pela migration `20260729000000_remove_ntfy_fields` ("ntfy notification option removed, only Telegram remains") — as rotas ficaram órfãs, **quebradas em runtime desde 2026-07-29** (Prisma rejeita select de coluna inexistente) e **sem nenhuma referência em UI ou testes** (verificado por grep). Decisão explícita: deletar código morto quebrado, não re-addicionar feature removida de propósito.
- `src/hooks/use-socket-realtime.ts`, `socketio-realtime-provider.tsx` — narrowing de `unknown` + tipo `NotificationReminder` estrutural (idêntico ao do store)
- `src/lib/realtime/socket-server/index.ts` + `src/types/socket-io.d.ts` — stub de tipos do `socket.io` (server self-host, fora do deploy Vercel), padrão já adotado pelo `socket-io-client.d.ts`
- `meta-ads-panel.tsx` — quirk de narrowing do TS em irmãos JSX (TS2367) → helper `sourceButtonClass()` com closure (sem comparações inline)
- `landing-lightbox.tsx` / `landing-page-client.tsx` / `empreendimentos/layout.tsx` — `useRef(undefined)`, `status ?? ''`, `crossOrigin`
