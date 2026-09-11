# Vercel Baseline — CRM Pro

**Data:** 2026-09-11
**Commit de referência:** `9eff674e68d13d721cd0372cd811ca3ba9c49d3e`
**Ambiente de medição:** sandbox local (4 GB RAM, Linux x64, Node 24.19.0)
**Regra de honestidade:** métricas de runtime da Vercel (invocações, active CPU, memória, p50/p95/p99, DB duration, Graph/Telegram calls) **não foram medidas** — a conta Vercel agrega a equipe inteira e não há decomposição por projeto disponível neste ambiente. Nenhum número abaixo é inventado; o que não foi medido está marcado como **não medido**.

## 1. Stack exata (instalada no lockfile)

| Pacote | Range no package.json | Versão instalada |
|---|---|---|
| next | ^16.1.1 | **16.1.3** (Turbopack default no build) |
| react / react-dom | ^19.0.0 | 19.x |
| prisma / @prisma/client | ^6.11.1 | **6.19.2** |
| next-auth | ^4.24.11 | 4.x (Credentials, JWT) |
| sharp | ^0.34.3 | 0.34.x (binários `@img` ~32,8 MB) |
| pdf-parse | ^1.1.1 | 1.1.x |
| xlsx | ^0.18.5 | 0.18.x |
| typescript | ^5 | 5.x |
| socket.io / socket.io-client | **ausentes** | stub de tipos em `src/types/socket-io-client.d.ts` (realtime é servidor externo opcional) |

Montagem do standalone: `output: "standalone"` + cópia manual de `.next/static` e `public` para `.next/standalone/` no script `build` (necessária no Next 16 — standalone não os embute).

## 2. Comandos usados na medição

```bash
# build local SEM tocar em banco (passos manuais do script build, sem vercel-migrate):
rm -rf .next
npx prisma generate            # offline, não conecta em banco
npx next build                 # DATABASE_URL local é sqlite — nenhuma escrita em produção
cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
du -sb .next/standalone .next/static public
npx tsc --noEmit --pretty false
npm test                       # node:test
npm run lint
```

Limitação de ambiente: build completo exige `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (placeholder) porque `src/lib/supabase-server.ts` lança erro **na importação do módulo** quando ausentes — achado de robustez (Fase 5 corrige para init lazy).

## 3. Baseline de artefatos de build (medido)

| Métrica | Valor medido |
|---|---|
| Build Turbopack (compile → standalone) | **40 s** (sandbox; Vercel: não medido) |
| `.next/standalone` | 157,0 MB |
| `.next/static` | 4,6 MB |
| `public/` | 0,4 MB |
| **Artefato final montado** | **161,9 MB** |
| `.next/server` (chunks server-side) | 13,2 MB (+16,9 MB em `chunks/ssr`) |

### Decomposição do `node_modules` do standalone (peso por deployment)

| Pacote | Tamanho | % do artefato | Observação |
|---|---:|---:|---|
| `@prisma` (client + engines) | 57,1 MB | 35% | inerente ao engineType=data-proxy/library; trocar por driver adapter exige benchmark (prompt veda trocar "por aparência") |
| `@img` (binários nativos do sharp) | 32,8 MB | 20% | importado por **2 rotas apenas** (images, floor-plans/upload-image) |
| `typescript` | 18,9 MB | 12% | **peso morto** — nenhum `require('typescript')` no grafo traçado; candidato a `outputFileTracingExcludes` (Fase 5) |
| `next` | 13,8 MB | 8,5% | runtime |
| demais (react-dom, z-ai-web-dev-sdk, semver…) | ~1,7 MB | 1% | — |

### Isolamento de libs pesadas por rota (import graph verificado)

| Lib | Arquivos que importam | Consumidores (rotas) | Status |
|---|---|---|---|
| sharp | 2 rotas de upload | `/api/enterprises/[id]/images`, `/api/enterprises/[id]/floor-plans/upload-image` | ✅ já segmentado |
| xlsx | 3 rotas | `/api/export`, `/api/enterprises/batch`, `/api/import` | ✅ já segmentado |
| pdf-parse | 2 libs (`parse-resale-pdf`, `extract-pdf-text`) | consumidas só por 3 rotas PDF de enterprises | ✅ já segmentado |
| socket.io (server) | 1 lib self-host (`src/lib/realtime/socket-server`) | não executado na Vercel | ✅ fora do runtime Vercel |

## 4. Baseline de qualidade (medido)

| Métrica | Valor |
|---|---|
| Rotas de API | **137** (136 em `/api` + `/lp/[slug]/go`) — inventário completo em `docs/route-inventory.md` |
| Rotas por categoria | autenticada 98 · mídia/PDF 14 · pública 10 · webhook 6 · pública(auth) 5 · relatório 2 · cron 2 |
| Pages | 12 |
| `npm test` (node:test) | **580/580 pass** |
| `npx tsc --noEmit` | **89 linhas de erro** (~55 erros reais + artefatos de provider — ver `docs/typecheck-baseline.md`) |
| `npm run lint` | 11 erros / 4 warnings (baseline pré-existente, inalterado nesta fase) |
| `typescript.ignoreBuildErrors` | `true` (risco apontado pela auditoria — tratado na Fase 2) |

## 5. Baseline de runtime Vercel (não medido)

| Métrica | Valor |
|---|---|
| Invocações por rota | não medido (requer dashboard Vercel por projeto/período) |
| active CPU / memória p95 | não medido |
| duração p50/p95/p99 | não medido |
| DB duration (Supabase) | não medido |
| Graph API / Telegram calls | não medido |
| erros/timeout 24–48 h | não medido |

Procedimento recomendado para medir (após esta entrega): Vercel Dashboard → Project **crm-pro** → Observability → filtrar 7 dias, exportar por rota; ou query GraphQL da Vercel API com token de somente-leitura. Sem esses números, cada otimização abaixo compara **antes/depois local** (artefatos, testes, typecheck) e marca runtime como pendente de canário.

## 6. Limitações

1. Sandbox sem acesso ao banco de produção (intencional — regra 2 do prompt) → `EXPLAIN ANALYZE` real fica para a fase de índices com `DIRECT_DATABASE_URL` de leitura.
2. OOM de build no sandbox resolveu após liberar ~1,2 GB (dev server morto); builds locais completos são viáveis mas não paralelizáveis com dev server.
3. Métricas de runtime só existem no dashboard Vercel (acesso do usuário).
