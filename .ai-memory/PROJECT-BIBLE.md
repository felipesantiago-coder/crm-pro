# PROJECT BIBLE — CRM Pro

> **Propósito**: Documento de recuperação de contexto para IA. Se você está lendo isso, perdeu o contexto da conversa anterior. Este arquivo contém tudo necessário para entender, manter e reconstruir o projeto.

> **REGRA**: Toda vez que fizer uma modificação relevante no projeto, ATUALIZE a seção correspondente deste arquivo e faça commit.

> **Última atualização**: 2026-07-04

---

## 1. VISÃO GERAL

### 1.1 O que é
CRM Pro — Sistema CRM para corretoras de imóveis brasileiras. Gerencia leads, clientes, empreendimentos, agendamentos, lembretes, parcerias entre corretores, e integra com Meta Ads (Facebook/Instagram), Telegram, Ntfy, WhatsApp (Meta Cloud API), Google Calendar e Supabase Realtime.

### 1.2 Stack Tecnológica
| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Framework | Next.js (App Router) | ^16.1.1 |
| React | React | ^19.0.0 |
| Linguagem | TypeScript | ^5 |
| Banco de dados | Supabase PostgreSQL v15 | — |
| ORM | Prisma | ^6.11.1 |
| Estilização | Tailwind CSS v4 + shadcn/ui | ^4 |
| Estado global | Zustand | ^5.0.6 |
| Tabelas | @tanstack/react-table | ^8.21.3 |
| Gráficos | Recharts | ^2.15.4 |
| Forms | react-hook-form + zod v4 | ^7.60.0 / ^4.0.2 |
| Autenticação | next-auth v4 (Credentials/JWT) | ^4.24.11 |
| Email | Resend | ^6.12.4 |
| WhatsApp | Meta Cloud API (Graph API v21.0) | — |
| Push notifications | Ntfy (self-hosted ou ntfy.sh) | — |
| Telegram | Bot API (long-polling style) | — |
| Google Calendar | OAuth2 direto (sem SDK) | — |
| Deploy | Vercel (standalone output) | region: gru1 |
| Runtime | Bun (local dev) / Node (Vercel) | — |

### 1.3 Repositório
- **GitHub**: `https://github.com/felipesantiago-coder/crm-pro.git`
- **Estrutura local**: `/home/z/my-project/repo-source/` (git submodule)
- **Deploy**: Vercel com `output: "standalone"` e região `gru1`

### 1.4 Scripts (package.json)
```bash
npm run dev          # next dev -p 3000 (com tee para dev.log)
npm run build        # prisma generate && next build + copia static/ e public/ para standalone
npm run start        # NODE_ENV=production bun .next/standalone/server.js
npm run lint         # eslint .
npm run db:push      # prisma db push
npm run db:generate  # prisma generate
npm run db:migrate   # prisma migrate dev
npm run db:reset     # prisma migrate reset
```

---

## 2. ESTRUTURA DE PASTAS

```
repo-source/
├── .ai-memory/                  # ← VOCÊ ESTÁ AQUI — memória persistente do projeto
│   └── PROJECT-BIBLE.md
├── prisma/
│   ├── schema.prisma            # Modelo de dados completo
│   └── migrations/              # Migrações SQL manuais para Supabase
├── public/
│   ├── logo.svg                 # Logo do CRM
│   ├── pixel.js                 # Tracking pixel JS (embedded em landing pages externas)
│   └── robots.txt               # SEO
├── scripts/                     # Scripts utilitários (Python/JS para automações)
├── src/
│   ├── app/                     # Páginas e API routes (App Router)
│   │   ├── layout.tsx           # Layout raiz (com SessionProvider)
│   │   ├── page.tsx             # Home — redireciona para dashboard se logado
│   │   ├── login/page.tsx       # Página de login
│   │   ├── change-password/page.tsx  # Troca de senha (mustChangePassword)
│   │   ├── globals.css          # CSS global + variáveis HSL do shadcn
│   │   ├── portal/page.tsx      # Portal do cliente (público, token-based)
│   │   ├── empreendimentos/     # Landing pages públicas
│   │   │   ├── layout.tsx       # Layout das landing pages
│   │   │   ├── page.tsx         # Listagem de empreendimentos
│   │   │   └── [slug]/
│   │   │       ├── page.tsx             # Server component da landing page
│   │   │       ├── landing-page-client.tsx  # Client component (1713 linhas — SPA-like)
│   │   │       └── cadastro-sucesso/page.tsx  # Pós-cadastro
│   │   └── api/                 # API Routes
│   │       ├── auth/
│   │       │   ├── [...nextauth]/route.ts    # next-auth handler
│   │       │   ├── change-password/route.ts  # Troca de senha
│   │       │   └── seed/route.ts            # Seed de admin user
│   │       ├── clients/          # CRUD de clientes
│   │       │   ├── route.ts             # GET (list), POST (create)
│   │       │   ├── [id]/route.ts         # GET, PATCH, DELETE
│   │       │   ├── [id]/stage/route.ts   # PATCH stage
│   │       │   ├── [id]/interactions/route.ts  # GET, POST
│   │       │   ├── [id]/schedules/route.ts     # GET, POST
│   │       │   ├── [id]/partners/route.ts      # GET, POST, DELETE
│   │       │   ├── [id]/context-memory/route.ts  # AI context
│   │       │   ├── [id]/portal-link/route.ts    # Generate portal link
│   │       │   ├── client-names/route.ts  # Search names
│   │       │   ├── regions/route.ts       # Distinct regions
│   │       │   ├── stats/route.ts         # Dashboard stats
│   │       │   ├── campaigns/route.ts     # Campaign stats
│   │       │   └── pipeline/route.ts      # Pipeline funnel data
│   │       ├── users/             # CRUD de usuários
│   │       ├── tags/              # CRUD de tags
│   │       ├── reminders/         # CRUD de lembretes + check cron
│   │       ├── schedules/         # Listagem geral de agendamentos
│   │       ├── enterprises/       # CRUD de empreendimentos + images + form-fields + public + catalog
│   │       ├── lead-queues/       # Fila de atendimento round-robin
│   │       │   ├── route.ts               # CRUD de filas
│   │       │   ├── [id]/route.ts          # GET, PATCH, DELETE fila
│   │       │   ├── [id]/members/route.ts  # GET, POST, PATCH, DELETE membros
│   │       │   ├── assign/route.ts        # POST — avança fila e atribui lead (SERIALIZABLE)
│   │       │   └── next-user/route.ts     # GET — peek sem avançar (para landing pages)
│   │       ├── webhooks/meta-leads/route.ts  # Webhook Meta Ads (lead generation)
│   │       ├── track/             # Tracking pixel endpoints
│   │       │   ├── route.ts       # POST — eventos do pixel JS
│   │       │   ├── pixel.gif/route.ts  # GET — 1x1 GIF + evento
│   │       │   ├── server/route.ts     # Server-side tracking
│   │       │   ├── dashboard/route.ts  # Dashboard de tracking
│   │       │   ├── campaigns/route.ts  # Campaign tracking data
│   │       │   └── reset/route.ts       # Reset tracking data
│   │       ├── notifications/cron/route.ts  # Cron: lembretes + agendamentos próximos
│   │       ├── meta-ads/          # Meta Ads panel data
│   │       ├── settings/          # System settings (Telegram, Ntfy, geral)
│   │       ├── google-calendar/   # OAuth2 + CRUD eventos
│   │       ├── telegram/          # Webhook de teste Telegram
│   │       ├── ntfy/              # Teste Ntfy
│   │       ├── ai-assistant/      # Chat com IA
│   │       ├── analytics/         # Analytics
│   │       ├── portal/            # Portal do cliente (verify, reschedule)
│   │       ├── export/            # Exportação de dados
│   │       ├── import/            # Importação de dados
│   │       ├── pipeline/          # Pipeline funnel
│   │       ├── profile/           # Perfil do usuário
│   │       └── route.ts           # API root (health check)
│   ├── components/
│   │   ├── auth/session-provider.tsx
│   │   ├── ai-assistant/ai-chat-widget.tsx
│   │   ├── crm/                  # COMPONENTES PRINCIPAIS DO CRM
│   │   │   ├── crm-layout.tsx    # Layout principal: sidebar + conteúdo (SPA-like com Zustand)
│   │   │   ├── dashboard-view.tsx
│   │   │   ├── clients-view.tsx  # Lista de clientes com busca/filtros
│   │   │   ├── client-card.tsx   # Card na lista
│   │   │   ├── client-detail.tsx # Detalhe do cliente (integrações, agendamentos, etc.)
│   │   │   ├── client-form.tsx   # Formulário criar/editar cliente
│   │   │   ├── kanban-board.tsx  # Kanban visual por stage
│   │   │   ├── enterprise-panel.tsx  # Painel do empreendimento
│   │   │   ├── enterprise-management.tsx  # CRUD empreendimentos
│   │   │   ├── gallery-manager.tsx  # Gerenciador de imagens
│   │   │   ├── form-field-manager.tsx  # Campos do formulário da landing
│   │   │   ├── landing-pages-tab.tsx  # Gerenciamento de landing pages
│   │   │   ├── meta-ads-panel.tsx  # Painel Meta Ads
│   │   │   ├── queues-tab.tsx    # Gerenciamento de filas de atendimento
│   │   │   ├── tags-view.tsx     # Gerenciamento de tags
│   │   │   ├── reminders-view.tsx  # Lembretes
│   │   │   ├── closed-deals-view.tsx  # Negócios fechados
│   │   │   ├── settings-view.tsx  # Configurações (Telegram, Ntfy, Meta)
│   │   │   ├── admin-panel.tsx   # Painel admin (users, roles)
│   │   │   ├── analytics-dashboard.tsx  # Dashboard de analytics
│   │   │   ├── tracking-tab.tsx  # Tab de tracking
│   │   │   ├── import-export.tsx  # Importar/exportar dados
│   │   │   ├── ai-context-memory.tsx  # Memória de contexto IA
│   │   │   └── supabase-realtime-provider.tsx  # Provider Supabase Realtime
│   │   └── ui/                   # Componentes shadcn/ui (NÃO ALTERAR MANUALMENTE — usar CLI)
│   ├── data/
│   │   └── enterprises-catalog.ts  # CATÁLOGO ESTÁTICO de empreendimentos (Ficha Técnica)
│   ├── hooks/
│   │   ├── use-session-guard.ts  # Redirect se não logado
│   │   ├── use-mobile.ts         # Detecta mobile
│   │   ├── use-toast.ts          # Toast hook
│   │   └── use-supabase-realtime.ts  # Realtime subscriptions
│   ├── lib/
│   │   ├── db.ts                 # Prisma client (Proxy lazy init + ensureDbConnection)
│   │   ├── auth.ts               # hashPassword, verifyPassword, isAdmin
│   │   ├── auth-options.ts       # NextAuth config (JWT 8h, Credentials)
│   │   ├── auth-middleware.ts    # Auth helpers
│   │   ├── api-auth.ts           # requireAuth(), requireAdmin()
│   │   ├── portal-token.ts       # HMAC-SHA256 portal tokens (TTL 7 dias)
│   │   ├── notifications.ts      # Orquestrador de notificações (email + WhatsApp)
│   │   ├── email.ts              # Resend email templates
│   │   ├── telegram.ts           # Telegram Bot notifications
│   │   ├── ntfy.ts               # Ntfy push notifications
│   │   ├── whatsapp.ts           # Meta Cloud API WhatsApp (template + fallback texto)
│   │   ├── google-calendar.ts    # OAuth2 + Calendar API
│   │   ├── rate-limit.ts         # In-memory rate limiter
│   │   ├── validations.ts        # Zod v4 schemas (client, interaction, schedule, etc.)
│   │   ├── phone-utils.ts        # Formatação telefone, WhatsApp URL, tel: link
│   │   ├── supabase-browser.ts   # Supabase client para browser (Realtime)
│   │   ├── supabase-server.ts    # Supabase client para server
│   │   └── utils.ts              # cn() helper (clsx + tailwind-merge)
│   ├── store/
│   │   └── crm-store.ts          # Zustand store (SPA-like navigation)
│   ├── types/
│   │   ├── next-auth.d.ts        # Augmentação de tipos do next-auth
│   │   └── global.d.ts           # Tipos globais
│   └── middleware.ts             # Edge middleware (cache-control, security headers)
├── .gitignore
├── components.json              # shadcn/ui config
├── next.config.ts               # standalone output, ignoreBuildErrors, Supabase images
├── tailwind.config.ts           # Dark mode class, shadcn color tokens
├── tsconfig.json
├── vercel.json                  # region: gru1
├── eslint.config.mjs
├── postcss.config.mjs
└── package.json
```

---

## 3. MODELO DE DADOS (Prisma Schema)

### 3.1 Models e Relações

```
User ──(1:N)──> Client (createdBy)
User ──(1:N)──> Schedule (createdBy)
User ──(N:N)──> Client (via ClientPartner: addedBy + userId)
User ──(1:N)──> LeadQueueMember
User ──(1:N)──> LeadQueueAssignment
User ──(1:1)──> GoogleCalendarToken
User ──(0:1)──> telegramChatId (unique, nullable)
User ──(0:1)──> ntfyTopic (unique, nullable)
User ──(0:1)──> ntfyToken (nullable)

Client ──(1:N)──> Interaction
Client ──(1:N)──> Reminder
Client ──(1:N)──> Schedule
Client ──(N:1)──> Enterprise (linkedEnterprise, nullable)
Client ──(1:N)──> ClientTag ──(N:1)──> Tag

Enterprise ──(1:N)──> EnterpriseImage
Enterprise ──(1:N)──> LandingFormField
Enterprise ──(1:N)──> Client

LeadQueue ──(1:N)──> LeadQueueMember ──(N:1)──> User
LeadQueue ──(1:N)──> LeadQueueAssignment ──(N:1)──> User

TrackingVisitor ──(1:N)──> TrackingEvent
```

### 3.2 Stages do Pipeline (Client.stage)
```
LEAD → PROSPECT → VISITA_AGENDADA → VISITA_REALIZADA → CARTA_PROPOSTA → CONTRATO_GERADO → FECHADO_GANHO
                                                                                              FECHADO_PERDIDO
```

### 3.3 Modelos Importantes

**Client**: name, phone, email, region, enterprise, enterpriseId, notes, updatePeriod (dias), stage, lastInteractionAt, createdBy, utmSource/Medium/Campaign/Content/Term

**User**: name, email, phone, passwordHash, role (USER/ADMIN), mustChangePassword, telegramChatId, ntfyTopic, ntfyToken

**Enterprise**: name, slug (unique), region, imageUrl, pdfContent, landingTitle/Subtitle/Description, cachedInfo (JSON), + EnterpriseImage[] + LandingFormField[]

**LeadQueue**: name, description, isActive, isDefault, currentIdx (round-robin counter)

**LeadQueueMember**: queueId, userId, order (sequential 0,1,2...), isActive

**LeadQueueAssignment**: queueId, userId, leadId (nullable, preenchido após criação do client), source

**TrackingVisitor**: visitorId (unique), siteId, leadId, firstSeenAt, lastSeenAt, ip, userAgent, country, city

**TrackingEvent**: visitorId, sessionId, siteId, eventType, eventName, pageUrl, referrer, utm*, metadata (JSON)

### 3.4 Índices existentes
Client: createdBy, stage, region, enterpriseId, utmCampaign, phone, email
Interaction: clientId, createdAt
Reminder: clientId, dueDate, notified+dueDate
Schedule: clientId, status
EnterpriseImage: enterpriseId
TrackingVisitor: siteId, leadId, lastSeenAt
TrackingEvent: siteId+eventType, siteId+utmCampaign, visitorId, sessionId, createdAt
LeadQueueMember: queueId+userId (unique), queueId
LeadQueueAssignment: queueId+createdAt, userId, leadId
LandingFormField: enterpriseId

---

## 4. SISTEMA DE AUTENTICAÇÃO

### 4.1 NextAuth Config (`src/lib/auth-options.ts`)
- **Provider**: Credentials (email + senha com bcrypt, saltRounds=12)
- **Strategy**: JWT com maxAge de 8 horas
- **Callbacks**:
  - `jwt`: Popula token com id, email, name, role, mustChangePassword. Em refresh sem `user`, consulta DB para mustChangePassword e role frescos. Se usuário não existe mais, retorna token vazio (força logout).
  - `session`: Expõe id, email, name, role, mustChangePassword no session.user.
- **Pages**: signIn → `/login`
- **Secret**: `process.env.NEXTAUTH_SECRET`

### 4.2 Auth Helpers (`src/lib/api-auth.ts`)
- `requireAuth()`: Retorna `{ error: 401 }` ou `{ error: null, session }`
- `requireAdmin()`: Mesmo + checa `role === 'ADMIN'`, retorna 403 se não

### 4.3 mustChangePassword
Quando true, o middleware ou layout redireciona para `/change-password`. Após trocar, o campo é setado para false no DB. O callback JWT sempre busca o valor fresco do DB em refresh para evitar que o valor antigo congele no token.

---

## 5. API ROUTES — MAPA COMPLETO

### 5.1 Rotas Públicas (sem auth)
| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/api/webhooks/meta-leads` | Verificação do webhook Meta (hub.challenge) |
| POST | `/api/webhooks/meta-leads` | Recebe leads do Meta Ads |
| POST | `/api/enterprises/public-lead` | Formulário de lead da landing page |
| GET | `/api/lead-queues/next-user` | Peek do próximo usuário na fila (sem avançar) |
| POST | `/api/lead-queues/assign` | Avança fila e atribui lead (SERIALIZABLE transaction) |
| POST | `/api/track` | Recebe eventos do tracking pixel JS |
| GET | `/api/track/pixel.gif` | 1x1 GIF + registro de evento (email tracking) |
| GET | `/api/portal/verify` | Verifica token do portal do cliente |
| POST | `/api/portal/reschedule` | Reagendamento pelo portal |
| GET | `/api/enterprises/public-list` | Lista pública de empreendimentos |
| GET | `/api/enterprises/public/[slug]` | Dados públicos de um empreendimento |
| GET | `/api/enterprises/catalog/[slug]` | Catálogo estático do empreendimento |

### 5.2 Rotas Protegidas (auth obrigatória)
| Método | Path | Descrição |
|--------|------|-----------|
| * | `/api/clients/*` | CRUD completo de clientes, interações, agendamentos, parceiros |
| * | `/api/users/*` | CRUD de usuários |
| * | `/api/tags/*` | CRUD de tags |
| * | `/api/reminders/*` | CRUD de lembretes |
| * | `/api/enterprises/*` | CRUD de empreendimentos (admin) |
| * | `/api/lead-queues/*` | Gerenciamento de filas |
| * | `/api/settings/*` | Configurações do sistema |
| * | `/api/google-calendar/*` | Integração Google Calendar |
| * | `/api/meta-ads/*` | Dados do Meta Ads |
| * | `/api/notifications/cron` | Cron de notificações |
| * | `/api/track/dashboard` | Dashboard de tracking |
| * | `/api/analytics` | Analytics |
| * | `/api/export` | Exportação |
| * | `/api/import` | Importação |
| * | `/api/profile` | Perfil do usuário logado |
| * | `/api/ai-assistant` | Chat com IA |

---

## 6. FLUXOS DE NEGÓCIO CRÍTICOS

### 6.1 Lead Queue (Round-Robin)

**Como funciona:**
1. Uma fila (`LeadQueue`) tem membros (`LeadQueueMember`) com `order` sequencial (0, 1, 2...)
2. `currentIdx` é incrementado a cada atribuição
3. O membro selecionado é `members[currentIdx % members.length]`
4. A atribuição é **atômica** (transaction SERIALIZABLE) para evitar race conditions

**Rotas:**
- `POST /api/lead-queues/assign` — Avança o counter e cria `LeadQueueAssignment`. Aceita `{ queueId?, source }`. Se sem queueId, usa fila default.
- `GET /api/lead-queues/next-user?slug=X&queueId=Y` — **PEEK** sem avançar. Busca fila por: (1) queueId direto, (2) slug via name/description match, (3) fallback para fila default.

**Reindexação ao remover membro** (`DELETE /api/lead-queues/[id]/members`):
- Após deletar, busca todos os membros restantes
- Reordena `order` sequencialmente (0, 1, 2...) em `$transaction`
- Se `currentIdx >= newLength`, faz `currentIdx = currentIdx % newLength`

### 6.2 Recebimento de Lead via Meta Ads (`POST /api/webhooks/meta-leads`)

**Fluxo:**
1. Verifica se webhook está habilitado (UserSettings: `meta_webhook_enabled`)
2. Valida assinatura HMAC-SHA256 (`X-Hub-Signature-256` header)
3. Parseia payload — para cada entry/change com field `leadgen` ou `leadgen_id`:
   a. Se `field_data` vazio, busca dados via Graph API (`v25.0/{leadgen_id}?fields=field_data`)
   b. Extrai nome, email, telefone, cidade
   c. Verifica duplicata (por phone OU email) → se existe, cria interação e pula
   d. **Resolve criador ANTES de criar cliente**: chama `/api/lead-queues/assign` → se fila disponível, usa userId. Senão, busca primeiro admin.
   e. Se nenhum usuário encontrado → `continue` (pula o lead, loga warn)
   f. Cria Client com `stage: 'LEAD'`, `updatePeriod: 1`, `createdBy: creatorId`
   g. Se veio de fila, vincula `leadId` na assignment via `updateMany` (match por queueId + userId + leadId:null + source)
   h. Cria interação inicial
   i. Dispara notificação (fire-and-forget) → `sendLeadNotification()`

**Configuração via UserSettings:**
- `meta_webhook_verify_token` — Token de verificação do webhook
- `meta_app_secret` — App Secret para HMAC
- `meta_webhook_enabled` — "true"/"false"
- `meta_page_access_token` — Page Access Token para Graph API
- `meta_lead_count` — Contador de leads recebidos (incrementado automaticamente)

### 6.3 Recebimento de Lead via Landing Page (`POST /api/enterprises/public-lead`)

**Fluxo:**
1. Rate limit: 5 req/min por IP
2. Valida: nome (min 2 chars), telefone (min 10 dígitos), email válido
3. Se slug fornecido, busca Enterprise por slug
4. Verifica duplicata (phone OU email) → se existe, cria interação e retorna `isExisting: true`
5. Chama `/api/lead-queues/assign` com source `landing_form:{slug}` ou `landing_form`
6. Fallback: primeiro admin user, senão `'system'`
7. Cria Client com UTM params, customAnswers no notes
8. Cria interação inicial
9. Dispara notificação (fire-and-forget) com fallback para admins

### 6.4 Sistema de Notificações

**Canais (fire-and-forget — nunca bloqueia o fluxo principal):**

1. **Email** (Resend): Para agendamentos, lembretes, parceiros, interações. Template HTML profissional com header gradiente verde. From: `CRM Pro <noreply@crmpro.app>`.

2. **Telegram** (`src/lib/telegram.ts`): Notificações de novo lead. Usa `sendMessage` API (long-polling style, sem webhook). Formato HTML com dados do lead + campanha + respostas do formulário. Precisa de `TELEGRAM_BOT_TOKEN` e `telegramChatId` no User.

3. **Ntfy** (`src/lib/ntfy.ts`): Push notifications. Cada usuário tem topic único (`crm-xxxxxxxx`) + token. Suporta markdown, priority 5, click action para abrir CRM. Não envia auth header (ntfy.sh public server).

4. **WhatsApp** (`src/lib/whatsapp.ts`): Meta Cloud API com template messages. Templates necessários: `crm_visita_agendada`, `crm_lembrete_vencido`, `crm_novo_parceiro`, `crm_nova_observacao`, `crm_visita_proxima`. Faz fallback para texto livre se template falhar.

**Fallback de notificação para leads:**
Se o usuário atribuído NÃO tem Telegram E NÃO tem Ntfy configurado, notifica TODOS os admins que tiverem algum canal ativo. Padrão usado tanto no Meta webhook quanto no public-lead.

### 6.5 Portal do Cliente

**URL**: `{NEXT_PUBLIC_APP_URL}/portal?t={token}&c={clientId}`

**Token**: HMAC-SHA256(payload, NEXTAUTH_SECRET) — payload = `clientId|createdAt|timestamp`. TTL: 7 dias. Formato: `base64url(timestamp).base64url(signature)`.

**O portal mostra**: dados do cliente, stage, empreendimento, agendamentos pendentes e passados. Permite reagendamento de visitas. Usa `verifyPortalToken()` com `timingSafeEqual`. Rate limit: 15 req/min.

### 6.6 Tracking Pixel

**JS client** (`public/pixel.js`): Embedded em landing pages externas. Gera visitorId, sessionId, rastreia pageview, form submissions, identify events.

**Server endpoints**:
- `POST /api/track`: Recebe eventos batch ou single. Normaliza snake_case → camelCase. Upsert visitor + create event. Em `identify` events, vincula leadId ao visitor para funnel tracking. Rate limit: 100/min/IP.
- `GET /api/track/pixel.gif`: Retorna 1x1 transparent GIF (43 bytes base64). Fire-and-forget event recording. Para email open tracking.

### 6.7 Catálogo Estático de Empreendimentos

**Arquivo**: `src/data/enterprises-catalog.ts`
**Propósito**: Fonte primária para a seção "Ficha Técnica" das landing pages. Eliminou dependência de AI extraction (Gemini/Groq).
**Mecanismo**: O `/api/enterprises/public/[slug]` faz merge: campos do catalog sobrescrevem, nulls usam fallback do DB (`cachedInfo`).
**Para atualizar**: Editar o arquivo e fazer redeploy.

---

## 7. MIDDLEWARE (`src/middleware.ts`)

Edge middleware executado em TODAS as requisições. Responsabilidades:

1. **Páginas HTML** (`/`, `/login`, `/change-password`, `/empreendimentos/*`, `/portal/*`): Headers `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` + `Pragma: no-cache` + `Expires: 0`
2. **API routes** (`/api/*`, exceto `/track/pixel.gif`): `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`
3. **Static assets** (`_next/static/*`): NÃO são interceptados (têm hash no nome, cacheáveis eternamente)

**Matcher**: `/`, `/login`, `/change-password`, `/empreendimentos/:path*`, `/portal/:path*`, `/api/:path*`, `/_next/data/:path*`

---

## 8. CONFIGURAÇÃO (next.config.ts)

- `output: "standalone"` — Necessário para Vercel com Prisma
- `typescript.ignoreBuildErrors: true` — Build não falha por erros TS
- `reactStrictMode: true`
- `images.remotePatterns`: Permite `*.supabase.co/storage/v1/object/public/**`
- `headers()`: API routes recebem `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`

---

## 9. VARIÁVEIS DE AMBIENTE NECESSÁRIAS

### Obrigatórias
| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | Connection string Supabase PostgreSQL |
| `NEXTAUTH_SECRET` | JWT signing secret |
| `NEXTAUTH_URL` | URL base do app (ex: `https://crmpro.vercel.app`) |

### Opcionais (por integração)
| Variável | Descrição | Integração |
|----------|-----------|------------|
| `TELEGRAM_BOT_TOKEN` | Token do @BotFather | Telegram |
| `NTFY_BASE_URL` | URL do servidor Ntfy (default: `https://ntfy.sh`) | Ntfy |
| `RESEND_API_KEY` | API key do Resend | Email |
| `NOTIFICATION_FROM_EMAIL` | Email remetente (default: `noreply@crmpro.app`) | Email |
| `WHATSAPP_ACCESS_TOKEN` | System User token | WhatsApp Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número WhatsApp Business | WhatsApp Meta |
| `WHATSAPP_VERSION` | Versão Graph API (default: `v21.0`) | WhatsApp Meta |
| `GOOGLE_CLIENT_ID` | OAuth2 Client ID | Google Calendar |
| `GOOGLE_CLIENT_SECRET` | OAuth2 Client Secret | Google Calendar |
| `GOOGLE_REDIRECT_URI` | Redirect URI OAuth2 | Google Calendar |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL (browser) | Realtime |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (browser) | Realtime |
| `NEXT_PUBLIC_APP_URL` | URL pública do app | Portal links |

---

## 10. PADRÕES DE CÓDIGO

### 10.1 Convenções
- **Linguagem do código**: TypeScript
- **Idioma da UI e mensagens**: Português brasileiro
- **Naming**: camelCase para variáveis/funções, PascalCase para componentes/types
- **Imports**: `@/` path alias para `src/`
- **CSS**: Tailwind utility classes + shadcn/ui components + CSS variables HSL
- **Estado**: Zustand para estado global (SPA-like navigation), React state para local
- **Formulários**: react-hook-form + zod v4 (importar de `zod/v4`)
- **Validação de API**: `validateBody(schema, body)` helper de `src/lib/validations.ts`
- **Auth em API routes**: Usar `requireAuth()` ou `requireAdmin()` de `src/lib/api-auth.ts`

### 10.2 Prisma Client (`src/lib/db.ts`)
- Usa **Proxy lazy initialization** — não crasha em build sem DATABASE_URL
- `ensureDbConnection(maxRetries=3)`: Retry com delays crescentes (3s, 4s, 5s) para Supabase cold-start
- Em dev: log level `['warn', 'error']`. Em prod: `['error']` apenas.

### 10.3 Padrão de API Response
- Sucesso: `NextResponse.json(data)` (200 ou 201)
- Erro: `NextResponse.json({ error: 'Mensagem' }, { status: 4xx/5xx })`
- Erro de validação: `validateBody` retorna `{ data: null, error: 'msg1; msg2' }`

### 10.4 CRM SPA-like Navigation
O CRM não usa rotas Next.js para navegação interna. Usa Zustand store (`useCRMStore`) com `currentView` que controla qual componente renderizar dentro do `crm-layout.tsx`. Views: `dashboard | enterprises | clients | closed-deals | tags | reminders | meta-ads | settings | admin | clientDetail`.

---

## 11. SUPABASE MIGRATIONS (SQL manual)

Arquivos SQL na raiz do projeto (não gerados pelo Prisma, aplicados manualmente no Supabase Dashboard):
- `supabase-setup.sql` — Setup inicial
- `supabase-migration-enterprise-images.sql` — Bucket de imagens
- `supabase-migration-enterprise-images-bucket.sql` — Bucket config
- `supabase-migration-reminder-google-calendar.sql` — Google Calendar
- `supabase-migration-notification-utm-fields.sql` — UTM fields + notificações
- `supabase-migration-landing-form-fields.sql` — Form fields
- `supabase-migration-add-pdfcontent.sql` — PDF content
- `supabase-migration-lead-queues.sql` — Lead queue tables
- `supabase-migration-user-phone.sql` — Phone no User
- `supabase-migration-tracking-pixel.sql` — Tracking tables
- `supabase-migration-pipeline-schedules.sql` — Pipeline + schedules
- `supabase-security-migration.sql` — Segurança RLS

---

## 12. ITENS PENDENTES (BACKLOG)

### Alta Prioridade
- [ ] **Rate limiting em endpoints públicos** — `/api/enterprises/public-lead` já tem (5/min). Verificar outros endpoints públicos.

### Média Prioridade
- [ ] **Meta Ads panel: correção de stages** — O painel do Meta Ads mapeia "CONTATO" para stage interno, mas deveria mapear para "PROSPECT" (o stage inicial correto após LEAD é PROSPECT)
- [ ] **SEO: generateMetadata nas landing pages** — Adicionar `generateMetadata()` em `empreendimentos/[slug]/page.tsx` para meta tags dinâmicas
- [ ] **Substituir `<img>` por `next/image` nas landing pages** — O `landing-page-client.tsx` usa `<img>` nativo em vez de `next/image` (otimização)

### Baixa Prioridade
- [ ] **Prisma @@index adicionais** — Verificar se há consultas que poderiam se beneficiar de mais índices compostos
- [ ] **Erros TS pré-existentes** — Arquivos como `auth/change-password`, `google-calendar`, tipo `CRMPIXEL` têm erros TypeScript que são pré-existentes (não causados por modificações recentes). `tsc --noEmit` mostra esses erros mas não bloqueiam build (`ignoreBuildErrors: true`).

---

## 13. HISTÓRICO DE MODIFICAÇÕES RELEVANTES

### 2026-07-04 — Sessão de Bug Fixes (Notificações + Lead Queue)
**5 bugs corrigidos e commitados:**

1. **`/api/lead-queues/next-user` — Slug sendo ignorado**: A rota aceitava `?slug=X` mas não usava. Agora busca fila por name/description matching slug (case insensitive), com fallback para fila default. Também adicionou `userPhone` na resposta e `phone: true` no select do user.

2. **`/api/webhooks/meta-leads` — Orfãos na fila**: O criador era resolvido DEPOIS de criar o cliente, causando atribuições sem `leadId`. Agora resolve criador ANTES (queue assign → admin fallback), cria cliente, e depois vincula `leadId` na assignment via `updateMany`.

3. **`/api/webhooks/meta-leads` — Sem fallback de notificação**: Se o usuário atribuído não tinha Telegram/Ntfy, ninguém era notificado. Adicionado `sendLeadNotification()` com fallback para todos os admins com canais ativos.

4. **`/api/webhooks/meta-leads` — `createdBy: 'system'` para leads sem usuário**: Quando não havia fila nem admin, o lead era criado com `createdBy: 'system'` (string, não FK válida). Agora faz `continue` (pula o lead e loga warn).

5. **`/api/lead-queues/[id]/members` DELETE — Reindexação**: Ao remover membro, os `order` ficavam com gaps (0, 2, 3...). Agora reindexa sequencialmente (0, 1, 2...) em `$transaction` e ajusta `currentIdx` se excedeu o novo tamanho.

### Sessão Anterior — 6 Bugs de Produção (Advertisements)
Detalhes não disponíveis no contexto atual, mas cobriram: correções no pipeline de anúncios, tratamento de webhook, e issues de UI.

---

## 14. NOTAS TÉCNICAS IMPORTANTES

### 14.1 Zod v4
O projeto usa `zod/v4` (import: `import { z } from 'zod/v4'`). NÃO usar `import { z } from 'zod'` que importa v3.

### 14.2 Tailwind CSS v4
O projeto usa Tailwind v4 com `@tailwindcss/postcss`. As cores são definidas via CSS variables HSL em `globals.css` e referenciadas no `tailwind.config.ts` como `hsl(var(--primary))`. O shadcn/ui usa esse sistema.

### 14.3 shadcn/ui
Componentes em `src/components/ui/` são gerados pelo CLI shadcn. NÃO editar manualmente — usar `npx shadcn@latest add <component>`.

### 14.4 Build não falha por TS errors
`next.config.ts` tem `typescript.ignoreBuildErrors: true`. Isso significa que erros TypeScript NÃO bloqueiam o build no Vercel. Ainda assim, é boa prática manter o código tipado corretamente.

### 14.5 Next.js 16 App Router
- Route handlers usam `export async function GET/POST/PUT/PATCH/DELETE`
- Dynamic route params são `Promise<{ id: string }>` em Next 16 — precisa `await params`
- Server Components por padrão, `'use client'` apenas quando necessário

### 14.6 Prisma Migrations
As migrações do Prisma (`prisma/migrations/`) são automáticas. Mas existem também migrações SQL manuais na raiz para features que precisam de SQL nativo do Supabase (RLS, buckets, etc.).

### 14.7 Email Templates
Todos em `src/lib/email.ts`. Usam HTML inline table layout (compatibilidade máxima com clients de email). Header com gradiente verde (`linear-gradient(135deg,#10b981,#0d9488)`). Footer com data automática.

### 14.8 WhatsApp Templates
Templates devem ser criados no Meta Business Manager. Nomes: `crm_visita_agendada`, `crm_lembrete_vencido`, `crm_novo_parceiro`, `crm_nova_observacao`, `crm_visita_proxima`. O código faz fallback para texto livre se o template falhar (dentro da janela de 24h).

### 14.9 Rate Limiting
Implementação in-memory em `src/lib/rate-limit.ts`. Map com auto-cleanup a cada 5 minutos. Para produção com múltiplas instâncias Vercel, considerar Redis/Upstash (notado no código mas não implementado).

---

## 15. COMO RECONSTRUIR O PROJETO DO ZERO

Se precisar reconstruir do absoluto zero:

1. **Criar projeto**: `npx create-next-app@latest` com TypeScript, Tailwind, App Router
2. **Instalar deps**: Copiar `package.json`, rodar `npm install`
3. **Configurar Prisma**: Copiar `prisma/schema.prisma`, rodar `npx prisma generate` + `npx prisma db push` (ou aplicar migrações SQL manualmente no Supabase)
4. **Configurar next.config.ts**: Copiar tal qual (standalone, ignoreBuildErrors, images, headers)
5. **Configurar middleware.ts**: Copiar tal qual (cache-control)
6. **Configurar tailwind + globals.css**: Copiar tailwind.config.ts e as CSS variables HSL do globals.css
7. **Configurar autenticação**: Copiar `src/lib/auth.ts`, `auth-options.ts`, `api-auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`
8. **Instalar shadcn/ui**: `npx shadcn@latest init` e adicionar os componentes necessários
9. **Copiar libs**: `db.ts`, `portal-token.ts`, `validations.ts`, `phone-utils.ts`, `rate-limit.ts`, `email.ts`, `telegram.ts`, `ntfy.ts`, `whatsapp.ts`, `google-calendar.ts`, `notifications.ts`, `supabase-browser.ts`, `utils.ts`
10. **Copiar store**: `crm-store.ts`
11. **Copiar data**: `enterprises-catalog.ts`
12. **Copiar componentes CRM**: Todos em `src/components/crm/`
13. **Copiar páginas**: `page.tsx`, `login/`, `change-password/`, `portal/`, `empreendimentos/`
14. **Copiar API routes**: Todos em `src/app/api/`
15. **Configurar env vars**: Todas da Seção 9
16. **Deploy**: Push para GitHub, conectar Vercel, configurar region `gru1`

> **NOTA**: Esta reconstrução geraria um projeto funcionalmente equivalente mas NÃO seria visualmente idêntico (Tailwind classes específicas, animações, responsividade exata não são capturáveis em texto). Para fidelidade visual 100%, é necessário ter acesso ao código-fonte.