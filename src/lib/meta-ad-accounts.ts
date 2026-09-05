import { db } from '@/lib/db';

// ============================================================
// Meta Ad Accounts — Multi-conta Meta Ads (captação multi-token)
// ============================================================
// Uma conta de anúncios (MetaAdAccount) tem o seu próprio access
// token (System User/Page), verify token e app secret opcionais de
// webhook, page_ids e form_ids. Assim o webhook e o polling conseguem
// capturar leads de CONTAS DIFERENTES de forma independente:
//
//   Webhook  → entry[].id (page id) resolve a conta → token da conta
//              é usado para buscar field_data do lead; verify token e
//              app secret da conta também são aceitos na validação.
//   Polling  → cada conta é consultada com o PRÓPRIO token (forms da
//              conta via formIds); forms sem conta continuam usando o
//              token global (comportamento legado preservado).
//   Routing  → resolveQueueForMetaLead aceita campaignId + adAccountId
//              (prioridade: campanha > formulário > conta > config > default).
//
// Degradacão graciosa: qualquer falha (ex.: migration pendente) é
// tratada e o fluxo legado (token global) segue funcionando —
// nenhum lead é perdido.
// ============================================================

/** Shape mínimo usado nas resoluções (independe do Prisma Client). */
export interface AdAccountRef {
  id: string;
  name: string;
  adAccountId: string;
  accessToken: string;
  verifyToken?: string | null;
  appSecret?: string | null;
  pageIds?: string | null;
  formIds?: string | null;
  queueId?: string | null;
}

/** Parse defensivo de JSON array de IDs (retorna [] em qualquer falha). */
export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v)).filter((v) => v.length > 0);
  } catch {
    return [];
  }
}

/**
 * Normaliza o ID de conta de anúncios: remove espaços e garante o
 * prefixo "act_" (formato aceito pela Graph API).
 *   "123456" → "act_123456"; "act_123456" → "act_123456"
 */
export function normalizeAdAccountId(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
}

/**
 * Resolve a conta de anúncios dona de uma page_id do Facebook.
 * O webhook envia entry[].id = page id — usamos o pageIds JSON de
 * cada conta para descobrir de qual conta/page o lead veio.
 */
export function resolveAccountByPageId<T extends AdAccountRef>(
  accounts: T[],
  pageId: string | null | undefined,
): T | null {
  if (!pageId) return null;
  const wanted = String(pageId);
  for (const account of accounts) {
    const pages = parseJsonArray(account.pageIds);
    if (pages.includes(wanted)) return account;
  }
  return null;
}

/**
 * Candidatos de App Secret para validar a assinatura HMAC do webhook:
 * secret global primeiro (comportamento legado), depois os secrets
 * das contas habilitadas. Sem duplicatas.
 */
export function buildWebhookSecretCandidates(
  globalSecret: string | null | undefined,
  accounts: Array<{ appSecret?: string | null; enabled?: boolean }>,
): string[] {
  const candidates: string[] = [];
  const push = (secret?: string | null) => {
    if (secret && !candidates.includes(secret)) candidates.push(secret);
  };
  push(globalSecret || null);
  for (const account of accounts) {
    if (account.enabled === false) continue;
    push(account.appSecret);
  }
  return candidates;
}

/**
 * Token de página a usar para buscar dados do lead (field_data):
 * token da conta resolvida primeiro; cai para o token global.
 */
export function resolvePageToken(
  account: Pick<AdAccountRef, 'accessToken'> | null | undefined,
  globalFallback: string | null | undefined,
): string | null {
  if (account?.accessToken) return account.accessToken;
  return globalFallback || null;
}

// ============================================================
// Helpers de banco (sempre com degradação graciosa)
// ============================================================

/**
 * Lista as contas de anúncios habilitadas para a captação.
 * Retorna [] em qualquer falha (migration pendente, banco offline…).
 */
export async function fetchEnabledAdAccounts(): Promise<AdAccountRef[]> {
  try {
    const accounts = await db.metaAdAccount.findMany({
      where: { enabled: true },
      select: {
        id: true,
        name: true,
        adAccountId: true,
        accessToken: true,
        verifyToken: true,
        appSecret: true,
        pageIds: true,
        formIds: true,
        queueId: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return accounts;
  } catch (err) {
    console.warn('[Meta Ad Accounts] Falha ao listar contas (migration pendente?):', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Resolve a conta de anúncios por page_id direto no banco (webhook).
 */
export async function resolveAdAccountForPage(
  pageId: string | null | undefined,
): Promise<AdAccountRef | null> {
  if (!pageId) return null;
  try {
    const accounts = await fetchEnabledAdAccounts();
    return resolveAccountByPageId(accounts, pageId);
  } catch (err) {
    console.warn('[Meta Ad Accounts] Falha ao resolver conta por page:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Auto-registro (fire-and-forget) do vínculo campanha → conta/fila.
 * Chamado pelo webhook e polling a cada lead com campaign_id.
 *
 * Regras:
 *   - Cria a binding com campaignName + adAccountId (quando conhecido).
 *   - Em updates, NUNCA sobrescreve a conta nem a fila já definidas
 *     (a fila é escolha do admin; a conta aprendida uma vez é estável).
 *   - Incrementa leadCount (observabilidade na UI).
 */
export function upsertCampaignBindingAuto(input: {
  campaignId: string;
  campaignName?: string | null;
  adAccountId?: string | null;
}): void {
  const { campaignId, campaignName, adAccountId } = input;
  if (!campaignId) return;
  // Fire-and-forget: falhas não podem interromper o processamento do lead.
  db.metaCampaignBinding
    .upsert({
      where: { campaignId },
      create: {
        campaignId,
        campaignName: campaignName || null,
        adAccountId: adAccountId || null,
        leadCount: 1,
      },
      update: {
        leadCount: { increment: 1 },
        campaignName: campaignName || undefined,
      },
    })
    .catch((err: unknown) => {
      console.warn(
        `[Meta Ad Accounts] Falha ao upsert campaign binding ${campaignId} (migration pendente?):`,
        err instanceof Error ? err.message : err,
      );
    });
}
