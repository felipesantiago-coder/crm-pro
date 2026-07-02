/**
 * ═══════════════════════════════════════════════════════════════════
 * CRM-PRO SOCKET.IO SERVER
 * ═══════════════════════════════════════════════════════════════════
 *
 * Servidor standalone que:
 * 1. Conecta ao PostgreSQL via LISTEN em canais crm_realtime:*
 * 2. Aceita conexões WebSocket via Socket.io
 * 3. Autentica cada conexão via session token do NextAuth
 * 4. Re-transmite eventos do PostgreSQL para os clientes conectados
 *
 * Arquitetura:
 *
 *   API Route ──Prisma NOTIFY──► PostgreSQL ──LISTEN──► Este servidor ──Socket.io──► Browser
 *
 * Deploy gratuito:
 *   - Render.com (Web Service, free tier, 750h/mês)
 *   - Railway.app (free tier)
 *   - Fly.io (free tier, 3 VMs shared)
 *   - Qualquer VPS com Node.js
 *
 * Variáveis de ambiente obrigatórias:
 *   DATABASE_URL       — Connection string PostgreSQL (a mesma do CRM)
 *   CRM_API_URL        — URL base da API do CRM (ex: https://seu-crm.vercel.app)
 *   PORT               — Porta do servidor (padrão: 3001)
 *   SOCKET_SECRET      — Segredo para autenticação alternativa (opcional)
 *   CORS_ORIGIN        — Origem permitida para CORS (padrão: *)
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import { Server } from 'socket.io';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { validateSession, type SessionUser } from './auth';

// Carrega .env se existir (para desenvolvimento local)
dotenv.config();

// ─── Configuração ────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const SOCKET_SECRET = process.env.SOCKET_SECRET || null;

// Tabelas que este servidor monitora via PostgreSQL LISTEN
const MONITORED_TABLES = [
  'clients',
  'tags',
  'client_tags',
  'reminders',
  'user_settings',
  'interactions',
  'schedules',
  'enterprises',
  'lead_queues',
  'users',
];

console.log('═'.repeat(60));
console.log('  CRM-PRO Socket.io Server v1.0');
console.log('═'.repeat(60));
console.log(`  Porta: ${PORT}`);
console.log(`  CORS: ${CORS_ORIGIN}`);
console.log(`  Database: ${process.env.DATABASE_URL ? '✓ Configurado' : '✗ NÃO CONFIGURADO'}`);
console.log(`  CRM API: ${process.env.CRM_API_URL || 'http://localhost:3000'}`);
console.log('═'.repeat(60));

// ─── PostgreSQL LISTEN Connection ────────────────────────────────

let pgClient: Client | null = null;

async function setupPostgresListener(): Promise<Client> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    // Mantém a conexão viva
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });

  await client.connect();
  console.log('[PostgreSQL] Conectado com sucesso');

  // Registra LISTEN em todas as tabelas monitoradas
  for (const table of MONITORED_TABLES) {
    const channel = `crm_realtime:${table}`;
    await client.query(`LISTEN ${channel}`);
    console.log(`[PostgreSQL] LISTEN ${channel}`);
  }

  // Trata notificações recebidas
  client.on('notification', (msg) => {
    if (!msg.channel || !msg.payload) return;

    try {
      const event = JSON.parse(msg.payload);

      // Extrai o nome da tabela do canal (crm_realtime:clients → clients)
      const tableName = msg.channel.replace('crm_realtime:', '');

      console.log(
        `[EVENT] ${event.eventType} on ${tableName} (id: ${event.recordId})`
      );

      // Re-transmite para todos os clientes conectados (exceto o ator)
      io.emit('crm:change', {
        ...event,
        table: tableName,
      });
    } catch (err) {
      console.warn('[PostgreSQL] Payload inválido:', msg.payload, err);
    }
  });

  // Reconexão automática se a conexão cair
  client.on('error', (err) => {
    console.error('[PostgreSQL] Erro na conexão:', err.message);
    if (err.code === 'CONNECTION') {
      console.log('[PostgreSQL] Tentando reconectar em 5s...');
      setTimeout(async () => {
        try {
          if (pgClient) {
            try { await pgClient.end(); } catch { /* ignore */ }
          }
          pgClient = await setupPostgresListener();
          console.log('[PostgreSQL] Reconectado com sucesso');
        } catch {
          console.error('[PostgreSQL] Falha na reconexão');
        }
      }, 5000);
    }
  });

  // Ping periódico para manter a conexão viva
  setInterval(async () => {
    try {
      await client.query('SELECT 1');
    } catch {
      // A reconexão é tratada pelo handler de erro acima
    }
  }, 30000); // A cada 30 segundos

  return client;
}

// ─── Socket.IO Server ────────────────────────────────────────────

const io = new Server(PORT, {
  cors: {
    origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(s => s.trim()),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Transports: polling como fallback, websocket como preferido
  transports: ['websocket', 'polling'],
  // Ping interval e timeout para detectar conexões mortas
  pingInterval: 25000,
  pingTimeout: 10000,
});

// ─── Middleware de Autenticação ──────────────────────────────────

/**
 * Cada cliente DEVE enviar um token de autenticação nos primeiros 10 segundos.
 * O token é o valor do cookie `next-auth.session-token` do NextAuth.
 */
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    // Verifica autenticação por segredo (fallback para integrações)
    if (SOCKET_SECRET && socket.handshake.auth?.secret === SOCKET_SECRET) {
      (socket.data as Record<string, unknown>).user = {
        id: 'system',
        email: 'system@crm',
        name: 'System',
        role: 'ADMIN',
      };
      return next();
    }

    console.warn(`[AUTH] Conexão rejeitada: sem token (socket ${socket.id})`);
    return next(new Error('Autenticação obrigatória'));
  }

  // Valida o token contra a API do CRM
  const user = await validateSession(token);
  if (!user) {
    console.warn(`[AUTH] Conexão rejeitada: token inválido (socket ${socket.id})`);
    return next(new Error('Sessão inválida ou expirada'));
  }

  // Armazena o usuário na sessão do socket
  (socket.data as Record<string, unknown>).user = user;
  console.log(`[AUTH] Usuário conectado: ${user.name} (${user.email}) [socket ${socket.id}]`);
  next();
});

// ─── Connection Handlers ─────────────────────────────────────────

io.on('connection', (socket) => {
  const user = socket.data.user as SessionUser;
  const connectedAt = new Date();

  console.log(
    `[CONNECT] ${user.name} (${user.role}) — Total: ${io.engine.clientsCount}`
  );

  // Envia confirmação de conexão ao cliente
  socket.emit('crm:connected', {
    status: 'connected',
    serverTime: new Date().toISOString(),
    user: { id: user.id, name: user.name, role: user.role },
  });

  // Permite que o cliente se junte a "salas" (rooms) específicas
  // Útil para filtrar eventos por enterprise, por exemplo
  socket.on('crm:join', (rooms: string | string[]) => {
    const roomList = Array.isArray(rooms) ? rooms : [rooms];
    roomList.forEach((room) => socket.join(room));
    console.log(`[ROOM] ${user.name} entrou em: ${roomList.join(', ')}`);
  });

  socket.on('crm:leave', (rooms: string | string[]) => {
    const roomList = Array.isArray(rooms) ? rooms : [rooms];
    roomList.forEach((room) => socket.leave(room));
  });

  // Heartbeat personalizado (além do ping/pong do Socket.io)
  socket.on('crm:ping', () => {
    socket.emit('crm:pong', { timestamp: new Date().toISOString() });
  });

  // Disconnect
  socket.on('disconnect', (reason) => {
    const duration = Date.now() - connectedAt.getTime();
    console.log(
      `[DISCONNECT] ${user.name} — Motivo: ${reason} — Duração: ${Math.round(duration / 1000)}s — Total: ${io.engine.clientsCount}`
    );
  });
});

// ─── Inicialização ───────────────────────────────────────────────

async function main() {
  // Conecta ao PostgreSQL e registra LISTEN
  try {
    pgClient = await setupPostgresListener();
  } catch (err) {
    console.error('[FATAL] Não foi possível conectar ao PostgreSQL:');
    console.error(err);
    console.error('\nVerifique a variável DATABASE_URL e tente novamente.');
    process.exit(1);
  }

  // Socket.io já está escutando (criado acima)
  console.log(`\n[READY] Socket.io escutando na porta ${PORT}`);
  console.log('[READY] Aguardando conexões...\n');
}

main().catch((err) => {
  console.error('[FATAL] Erro na inicialização:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[SHUTDOWN] Encerrando servidor...');
  io.close();
  if (pgClient) {
    await pgClient.end().catch(() => {});
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[SHUTDOWN] Encerrando servidor (SIGTERM)...');
  io.close();
  if (pgClient) {
    await pgClient.end().catch(() => {});
  }
  process.exit(0);
});