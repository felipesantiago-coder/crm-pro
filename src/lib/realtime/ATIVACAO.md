# ═══════════════════════════════════════════════════════════════════════════
# GUIA DE ATIVAÇÃO — Socket.io Realtime
# ═══════════════════════════════════════════════════════════════════════════
#
# Este guia descreve como ativar o Socket.io Realtime como substituto
# ao Supabase Realtime. Siga os passos EM ORDEM.
#
# Pré-requisito: o servidor Socket.io precisa estar deployado e rodando.
# ═══════════════════════════════════════════════════════════════════════════

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FASE 1: Deploy do Servidor Socket.io
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Opção A: Render.com (gratuito, recomendado)

1. Crie uma conta em https://render.com
2. Crie um novo "Web Service"
3. Conecte seu repositório GitHub
4. Configure:
   - Root Directory: src/lib/realtime/socket-server
   - Build Command: npm install
   - Start Command: npm start
   - Environment: Node
5. Adicione as variáveis de ambiente:
   - DATABASE_URL=(a mesma string do Supabase/Neon)
   - CRM_API_URL=https://seu-crm.vercel.app
   - CORS_ORIGIN=https://seu-crm.vercel.app
   - PORT=3001
6. Deploy

## Opção B: Railway.app (gratuito)

1. Crie uma conta em https://railway.app
2. Novo projeto → Deploy from GitHub repo
3. Selecione o repo e configure o Root Directory como: src/lib/realtime/socket-server
4. Adicione as mesmas variáveis de ambiente acima
5. Deploy

## Opção C: VPS / Vercel não suporta WebSocket nativo

NOTA: Não deploye o servidor Socket.io no Vercel. O Vercel não suporta
conexões WebSocket de longa duração. Use Render, Railway, Fly.io ou um VPS.

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FASE 2: Configuração no CRM (Vercel)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Passo 1: Variável de ambiente

No painel do Vercel (Settings → Environment Variables), adicione:

  NEXT_PUBLIC_SOCKET_URL=https://seu-socket-server.onrender.com

Isso ativa o Socket.io no client-side. O Supabase Realtime continua funcionando
enquanto você não trocar o Provider.

## Passo 2: Instalar socket.io-client no projeto CRM

O hook useSocketRealtime importa de 'socket.io-client'. Instale:

  cd seu-projeto
  npm install socket.io-client

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FASE 3: Trocar o Provider (ativação final)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## No arquivo: src/app/page.tsx

### ANTES (Supabase Realtime):
  import { SupabaseRealtimeProvider } from '@/components/crm/supabase-realtime-provider'

  <SupabaseRealtimeProvider>
    ...seu app...
  </SupabaseRealtimeProvider>

### DEPOIS (Socket.io Realtime):
  import { SocketioRealtimeProvider } from '@/components/crm/socketio-realtime-provider'

  <SocketioRealtimeProvider>
    ...seu app...
  </SocketioRealtimeProvider>

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FASE 4: Adicionar emitter nas API routes (para eventos chegarem ao Socket.io)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Sem os emitters, o Socket.io NÃO recebe eventos. O emitter usa PostgreSQL NOTIFY,
# que é capturado pelo servidor Socket.io via LISTEN.
#
# IMPORTANTE: O emitter é fire-and-forget. Se falhar, não afeta a API route.
# O NEXT_PUBLIC_SOCKET_URL controla se o emitter está ativo.

## Arquivos que PRECISAM do emitter (tabelas monitoradas):

### src/app/api/clients/route.ts (POST - criar cliente)
  import { emitClientChange } from '@/lib/realtime/realtime-emitter';
  // Após db.client.create():
  await emitClientChange('INSERT', client.id, client.name, userId);

### src/app/api/clients/[id]/route.ts (PATCH - atualizar, DELETE - remover)
  import { emitClientChange } from '@/lib/realtime/realtime-emitter';
  // PATCH:
  await emitClientChange('UPDATE', id, updatedClient.name, userId);
  // DELETE:
  await emitClientChange('DELETE', id, existingClient.name, userId);

### src/app/api/tags/route.ts (POST - criar tag)
  import { emitTagChange } from '@/lib/realtime/realtime-emitter';
  await emitTagChange('INSERT', tag.id, tag.name, userId);

### src/app/api/tags/[id]/route.ts (PATCH, DELETE)
  import { emitTagChange } from '@/lib/realtime/realtime-emitter';

### src/app/api/reminders/route.ts (POST - criar lembrete)
  import { emitReminderChange } from '@/lib/realtime/realtime-emitter';
  await emitReminderChange('INSERT', reminder.id, reminder.title, userId);

### src/app/api/reminders/[id]/route.ts (PATCH, DELETE)
  import { emitReminderChange } from '@/lib/realtime/realtime-emitter';

### src/app/api/settings/route.ts (POST - atualizar user_settings)
  import { emitUserSettingsChange } from '@/lib/realtime/realtime-emitter';
  await emitUserSettingsChange(userId);

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FASE 5: Testar
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Abra o CRM em 2 abas do navegador (com users diferentes se possível)
2. Na aba 1, crie um cliente
3. Na aba 2, deve aparecer o toast "Novo cliente: [nome]"
4. Abra o console do navegador (F12) e procure por "[Socket.io] Conectado"
5. Verifique os logs do servidor Socket.io para confirmar o fluxo:
   - [AUTH] Usuário conectado: ...
   - [EVENT] INSERT on clients (id: ...)
   - [CONNECT] ... Total: 2

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ROLLBACK (desativar e voltar ao Supabase Realtime)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. No Vercel, remova NEXT_PUBLIC_SOCKET_URL
2. Em src/app/page.tsx, troque SocketioRealtimeProvider de volta para SupabaseRealtimeProvider
3. Os emitter calls nas API routes são inofensivos sem a variável (eles verificam e retornam sem fazer nada)
4. Remova socket.io-client do package.json se desejar: npm uninstall socket.io-client

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# RESUMO DA ARQUITETURA
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#
#   Browser A ──────► API Route ──► Prisma INSERT ──► PostgreSQL NOTIFY
#                                                                  │
#   Browser B ◄──── Socket.io Server ◄─── PostgreSQL LISTEN ◄──────┘
#   (toast!)
#
#   Custo: R$ 0,00 (servidor gratuito + PostgreSQL que já existe)
#   Latência: ~100-300ms (NOTIFY → LISTEN → WebSocket)
#   Segurança: Autenticação via session token do NextAuth
#   Confiabilidade: Reconnect automático, heartbeat, graceful shutdown
#
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━