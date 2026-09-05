import { db } from '@/lib/db';

// ============================================================
// Meta Lead Routing — Roteamento multi-anúncio para filas
// ============================================================
// Cada anúncio/formulário Meta pode ter sua própria fila de
// atendimento (round-robin independente por fila). Este módulo é
// a FONTE ÚNICA de roteamento usada tanto pelo webhook quanto
// pelo polling, garantindo que leads de fontes diferentes nunca
// sejam confundidos entre si.
//
// Ordem de prioridade:
//   1. MetaCampaignBinding.queueId — vínculo manual por CAMPAIGN id
//                                    (fila específica da campanha;
//                                    binding auto-registrada a cada
//                                    lead com campaign_id)
//   2. LeadFormMapping.queueId    — vínculo manual por formulário
//   3. MetaAdAccount.queueId      — fila default da conta de anúncios
//                                    (quando a conta de origem é
//                                     conhecida — multi-conta)
//   4. MetaCapConfig.queueId      — fila preferencial do config CAPI
//                                    (por capiConfigId resolvido ou
//                                     pelos formIds do config)
//   5. undefined                  — fila default (isDefault=true),
//                                    comportamento legado preservado
//
// Degradacão graciosa: se as colunas/tabelas de roteamento ainda não
// existirem no banco (migration pendente), qualquer falha é
// tratada e o lead cai na fila default — nunca é perdido.
// ============================================================

export interface MetaLeadRouteInput {
  /** Form ID do lead (webhook e polling sempre enviam). */
  formId?: string;
  /** Campaign ID do lead (webhook e polling enviam quando disponível).
   *  Permite fila ESPECÍFICA por campanha (MetaCampaignBinding). */
  campaignId?: string;
  /** CAPI config já resolvido para o lead (opcional). */
  capiConfigId?: string | null;
  /** Conta de anúncios já resolvida para o lead (multi-conta; opcional). */
  adAccountId?: string | null;
}

export interface ResolvedLeadRoute {
  queueId?: string;
  queueName?: string;
  /** De onde veio o roteamento (para logs/observabilidade). */
  routeSource: 'campaign_binding' | 'form_mapping' | 'ad_account' | 'capi_config' | 'capi_config_by_form' | 'default';
}

/** Cache em memória curto (10s) para não consultar roteamento a cada lead em bursts. */
const routeCache = new Map<string, { value: ResolvedLeadRoute; expiresAt: number }>();
const ROUTE_CACHE_TTL = 10_000;

function getCache(key: string): ResolvedLeadRoute | null {
  const hit = routeCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  if (hit) routeCache.delete(key);
  return null;
}

function setCache(key: string, value: ResolvedLeadRoute) {
  // Limita tamanho do cache (proteção simples contra crescimento)
  if (routeCache.size > 500) routeCache.clear();
  routeCache.set(key, { value, expiresAt: Date.now() + ROUTE_CACHE_TTL });
}

/**
 * Valida que a fila existe e está ativa. Se não estiver, retorna
 * undefined para cair na fila default (lead nunca fica sem atendimento).
 */
async function getActiveQueue(queueId: string): Promise<{ id: string; name: string } | null> {
  try {
    const queue = await db.leadQueue.findFirst({
      where: { id: queueId, isActive: true },
      select: { id: true, name: true },
    });
    return queue ?? null;
  } catch (err) {
    console.warn('[Meta Lead Routing] Falha ao validar fila', queueId, err);
    return null;
  }
}

/**
 * Resolve a fila de atendimento para um lead Meta.
 *
 * @example
 * const { queueId, routeSource } = await resolveQueueForMetaLead({ formId, capiConfigId });
 * await assignLeadToUser({ leadId, queueId, source });
 */
export async function resolveQueueForMetaLead(input: MetaLeadRouteInput): Promise<ResolvedLeadRoute> {
  const { formId, campaignId, capiConfigId, adAccountId } = input;

  // Sem formId nem campaignId não há como rotear por fonte — fila default
  if (!formId && !campaignId) return { queueId: undefined, routeSource: 'default' };

  const cacheKey = `${campaignId || ''}|${formId || ''}|${capiConfigId || ''}|${adAccountId || ''}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    // 1. Vínculo manual por CAMPAIGN (mais específico — fila da campanha)
    if (campaignId) {
      try {
        const binding = await db.metaCampaignBinding.findUnique({
          where: { campaignId },
          select: { queueId: true },
        });
        if (binding?.queueId) {
          const queue = await getActiveQueue(binding.queueId);
          if (queue) {
            const value: ResolvedLeadRoute = { queueId: queue.id, queueName: queue.name, routeSource: 'campaign_binding' };
            setCache(cacheKey, value);
            return value;
          }
        }
      } catch (err) {
        // Tabela pode não existir ainda (migration pendente)
        console.warn('[Meta Lead Routing] campaign_binding lookup falhou (migration pendente?):', err instanceof Error ? err.message : err);
      }
    }

    // 2. Vínculo manual por formulário
    if (formId) {
      try {
        const mapping = await db.leadFormMapping.findFirst({
          where: { formId, queueId: { not: null } },
          select: { queueId: true },
          orderBy: { lastSeenAt: 'desc' },
        });
        if (mapping?.queueId) {
          const queue = await getActiveQueue(mapping.queueId);
          if (queue) {
            const value: ResolvedLeadRoute = { queueId: queue.id, queueName: queue.name, routeSource: 'form_mapping' };
            setCache(cacheKey, value);
            return value;
          }
        }
      } catch (err) {
        // Coluna queueId pode não existir ainda (migration pendente)
        console.warn('[Meta Lead Routing] form_mapping lookup falhou (migration pendente?):', err instanceof Error ? err.message : err);
      }
    }

    // 3. Fila default da conta de anúncios (multi-conta)
    if (adAccountId) {
      try {
        const account = await db.metaAdAccount.findFirst({
          where: { id: adAccountId, enabled: true, queueId: { not: null } },
          select: { queueId: true },
        });
        if (account?.queueId) {
          const queue = await getActiveQueue(account.queueId);
          if (queue) {
            const value: ResolvedLeadRoute = { queueId: queue.id, queueName: queue.name, routeSource: 'ad_account' };
            setCache(cacheKey, value);
            return value;
          }
        }
      } catch (err) {
        console.warn('[Meta Lead Routing] ad_account lookup falhou (migration pendente?):', err instanceof Error ? err.message : err);
      }
    }

    // 4a. Fila preferencial do config CAPI já resolvido para o lead
    if (capiConfigId) {
      try {
        const config = await db.metaCapConfig.findFirst({
          where: { id: capiConfigId, enabled: true, queueId: { not: null } },
          select: { queueId: true },
        });
        if (config?.queueId) {
          const queue = await getActiveQueue(config.queueId);
          if (queue) {
            const value: ResolvedLeadRoute = { queueId: queue.id, queueName: queue.name, routeSource: 'capi_config' };
            setCache(cacheKey, value);
            return value;
          }
        }
      } catch (err) {
        console.warn('[Meta Lead Routing] capi_config lookup falhou (migration pendente?):', err instanceof Error ? err.message : err);
      }
    }

    // 4b. Config com o formId no JSON formIds que tenha fila preferencial
    try {
      const enabledConfigs = await db.metaCapConfig.findMany({
        where: { enabled: true, queueId: { not: null } },
        select: { id: true, queueId: true, formIds: true },
      });
      for (const config of enabledConfigs) {
        if (!config.formIds || !formId) continue;
        try {
          const ids: string[] = JSON.parse(config.formIds);
          if (Array.isArray(ids) && ids.includes(formId) && config.queueId) {
            const queue = await getActiveQueue(config.queueId);
            if (queue) {
              const value: ResolvedLeadRoute = { queueId: queue.id, queueName: queue.name, routeSource: 'capi_config_by_form' };
              setCache(cacheKey, value);
              return value;
            }
          }
        } catch {
          // JSON inválido, skip
        }
      }
    } catch (err) {
      console.warn('[Meta Lead Routing] capi_config_by_form lookup falhou (migration pendente?):', err instanceof Error ? err.message : err);
    }
  } catch (outerErr) {
    console.error('[Meta Lead Routing] Erro inesperado no roteamento — usando fila default:', outerErr);
  }

  // 3. Fila default (comportamento legado)
  const value: ResolvedLeadRoute = { queueId: undefined, routeSource: 'default' };
  setCache(cacheKey, value);
  return value;
}

/**
 * Executa `fn` sobre itens em paralelo com concorrência limitada.
 * Sem dependências externas; preserva a ordem dos resultados
 * (Promise.allSettled por chunks, em sequência de chunks).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));

  for (let start = 0; start < items.length; start += limit) {
    const chunk = items.slice(start, start + limit);
    const settled = await Promise.allSettled(
      chunk.map((item, offset) => fn(item, start + offset)),
    );
    for (let i = 0; i < chunk.length; i++) {
      results[start + i] = settled[i];
    }
  }

  return results;
}
