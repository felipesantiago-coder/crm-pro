// ============================================================
// META OAUTH — camada de BANCO (Prisma) do fluxo OAuth.
// Mantida separada de meta-oauth.ts (puro + Graph) para que a lógica
// testável não dependa do banco. Este módulo:
//
//   1. resolveMetaAppCredentials   — App ID/Secret do fluxo (env + DB)
//   2. persistOAuthConnection      — reconexão de 1 conta OU criação em
//                                    lote das contas autorizadas
//   3. registerAccountAuthFailure  — (b) marca conta com token expirado
//                                    /permissão negada em runtime
//   4. clearAccountAuthState       — (b) limpa o estado após sucesso
// ============================================================

import { db } from '@/lib/db';
import { normalizeAdAccountId } from '@/lib/meta-ad-accounts';
import { classifyGraphAuthFailure, fetchAccountPromotablePages } from '@/lib/meta-oauth';
import type { GrantedAdAccount, GrantedPage } from '@/lib/meta-oauth';

// ============================================================
// 1. Credenciais do APP para o OAuth (o MESMO app já conectado ao CRM)
// ============================================================
// Prioridade:
//   a) env META_APP_ID + META_APP_SECRET          (caminho canônico)
//   b) env META_APP_ID + App Secret verificado de uma conta cujo appId salvo confere
//   c) qualquer conta com appId + appSecret salvos (validação 4f3c5a2)
// Assim o OAuth funciona no deploy atual SEM novo onboarding de envs.

export interface ResolvedMetaAppCredentials {
  appId: string;
  appSecret: string;
  /** De onde veio: 'env' | 'env+db' | 'db' (observabilidade). */
  source: 'env' | 'env+db' | 'db';
}

export async function resolveMetaAppCredentials(): Promise<ResolvedMetaAppCredentials | null> {
  const envAppId = process.env.META_APP_ID?.trim();
  const envAppSecret = process.env.META_APP_SECRET?.trim();

  if (envAppId && envAppSecret) {
    return { appId: envAppId, appSecret: envAppSecret, source: 'env' };
  }

  try {
    const accounts = await db.metaAdAccount.findMany({
      where: { appSecret: { not: null } },
      select: { appId: true, appSecret: true },
    });
    if (envAppId) {
      const match = accounts.find((a) => a.appId === envAppId && a.appSecret);
      if (match?.appSecret) {
        return { appId: envAppId, appSecret: match.appSecret, source: 'env+db' };
      }
      return null;
    }
    const withAppId = accounts.find((a) => a.appId && a.appSecret);
    if (withAppId?.appId && withAppId.appSecret) {
      return { appId: withAppId.appId, appSecret: withAppId.appSecret, source: 'db' };
    }
  } catch (e) {
    console.warn('[Meta OAuth] Falha ao resolver credenciais via banco:', e instanceof Error ? e.message : e);
  }
  return null;
}

// ============================================================
// 2. Persistência da conexão autorizada
// ============================================================

export interface PersistConnectionInput {
  /** Token de USUÁRIO de longa duração (ou curto, no fallback). */
  token: string;
  tokenExpiresAt: Date | null;
  appId: string;
  /** App secret resolvido — salvo nas contas novas para o HMAC do
   *  webhook delas validar de cara (validação de assinatura). */
  appSecret: string | null;
  /** Contas de anúncio ATIVAS autorizadas (status 1). */
  adAccounts: GrantedAdAccount[];
  /** Páginas do usuário (fallback do mapeamento página → conta). */
  pages: GrantedPage[];
  /** (b) Reconectar UMA conta existente em vez de criar novas. */
  reconnectAccountId?: string | null;
}

export type PersistConnectionResult =
  | { mode: 'reconnect'; account: { id: string; name: string } }
  | {
      mode: 'connect';
      created: Array<{ id: string; name: string; adAccountId: string }>;
      skipped: Array<{ adAccountId: string; name: string; reason: string }>;
    };

/** Mescla page tokens novos no JSON pageTokens da conta (page tokens
 *  não expiram — coração do fetch de field_data do webhook). */
function mergePageTokens(existing: string | null | undefined, pages: GrantedPage[]): string | null {
  let map: Record<string, string> = {};
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) map = parsed;
    } catch { /* substitui */ }
  }
  for (const p of pages) {
    if (p.id && p.accessToken) map[p.id] = p.accessToken;
  }
  const keys = Object.keys(map);
  return keys.length > 0 ? JSON.stringify(map) : null;
}

export async function persistOAuthConnection(input: PersistConnectionInput): Promise<PersistConnectionResult> {
  // ── (b) RECONEXÃO: atualiza UMA conta existente ─────────────
  if (input.reconnectAccountId) {
    const row = await db.metaAdAccount.findUnique({
      where: { id: input.reconnectAccountId },
      select: { id: true, name: true, adAccountId: true, pageTokens: true, pageIds: true, appSecret: true },
    });
    if (!row) {
      throw new Error('account_not_found');
    }
    const data: Record<string, unknown> = {
      accessToken: input.token,
      tokenExpiresAt: input.tokenExpiresAt,
      authSource: 'oauth',
      authStatus: 'ok',
      lastAuthError: null,
      lastAuthErrorAt: null,
    };
    if (input.appSecret && !row.appSecret) {
      // Preenche o App Secret do app (valida HMAC do webhook) apenas se
      // a conta não tiver um secret próprio já salvo.
      data.appSecret = input.appSecret;
    }
    await db.metaAdAccount.update({ where: { id: row.id }, data });
    return { mode: 'reconnect', account: { id: row.id, name: row.name } };
  }

  // ── CONEXÃO: cria uma linha por conta de anúncio ATIVA autorizada ──
  const created: Array<{ id: string; name: string; adAccountId: string }> = [];
  const skipped: Array<{ adAccountId: string; name: string; reason: string }> = [];

  const hadAnyAccount = (await db.metaAdAccount.count()) > 0;

  for (const adAccount of input.adAccounts) {
    const normalized = normalizeAdAccountId(adAccount.id);
    if (!normalized) {
      skipped.push({ adAccountId: adAccount.id, name: adAccount.name, reason: 'ID inválido' });
      continue;
    }
    const existing = await db.metaAdAccount.findUnique({ where: { adAccountId: normalized }, select: { id: true, name: true } });
    if (existing) {
      // Conta já cadastrada: NÃO sobrescreve token manual/System User
      // silenciosamente — reconnection explícita é o caminho de renovação.
      skipped.push({ adAccountId: normalized, name: existing.name || adAccount.name, reason: 'já cadastrada' });
      continue;
    }

    // pageIds precisos: páginas que anunciam PARA esta conta; fallback
    // (edge falhou) = todas as páginas do usuário — webhook continua
    // funcionando e o diagnóstico corrige depois.
    let accountPages: GrantedPage[] = [];
    try {
      accountPages = await fetchAccountPromotablePages(input.token, normalized);
    } catch {
      accountPages = [];
    }
    if (accountPages.length === 0) accountPages = input.pages;

    const row = await db.metaAdAccount.create({
      data: {
        name: adAccount.name || `Conta ${normalized}`,
        adAccountId: normalized,
        accessToken: input.token,
        appSecret: input.appSecret,
        pageIds: accountPages.length > 0 ? JSON.stringify(accountPages.map((p) => p.id)) : null,
        pageTokens: mergePageTokens(null, accountPages),
        authSource: 'oauth',
        authStatus: 'ok',
        tokenExpiresAt: input.tokenExpiresAt,
        // Primeira conta criada num CRM vazio vira a padrão.
        isDefault: !hadAnyAccount && created.length === 0,
        enabled: true,
      },
    });
    created.push({ id: row.id, name: row.name, adAccountId: row.adAccountId });
  }

  return { mode: 'connect', created, skipped };
}

// ============================================================
// 3/4. (b) Estado de autenticação em runtime
// ============================================================

export interface AuthFailureInput {
  code?: number | string | null;
  message?: string | null;
}

/** Marca a conta quando o uso do token falhou na Graph API:
 *  190/102 → 'expired'; 200/10 → 'permission_denied'. Falhas
 *  transitórias (rate limit) e erros não-auth NÃO alteram a conta. */
export async function registerAccountAuthFailure(accountId: string, failure: AuthFailureInput): Promise<void> {
  const kind = classifyGraphAuthFailure(failure.code ?? null);
  if (!kind || kind === 'transient') return;
  try {
    await db.metaAdAccount.update({
      where: { id: accountId },
      data: {
        authStatus: kind === 'expired' ? 'expired' : 'permission_denied',
        lastAuthError: (failure.message || `Graph API code ${failure.code ?? '?'}`).slice(0, 400),
        lastAuthErrorAt: new Date(),
      },
    });
  } catch (e) {
    console.warn(`[Meta OAuth] Falha ao registrar auth failure da conta ${accountId}:`, e instanceof Error ? e.message : e);
  }
}

/** Sucesso comprovado do token — limpa o estado de erro (mantém a
 *  expiração, que continua real). */
export async function clearAccountAuthState(accountId: string): Promise<void> {
  try {
    await db.metaAdAccount.update({
      where: { id: accountId },
      data: { authStatus: 'ok', lastAuthError: null },
    });
  } catch {
    // Conta removida no meio do run — ignorar.
  }
}
