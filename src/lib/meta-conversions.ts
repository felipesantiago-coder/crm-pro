import crypto from 'crypto';

// ============================================================
// Meta Conversions API (CAPI) — Multi-client CRM Integration
// Envia eventos de mudança de stage do CRM de volta para a Meta
// para otimização de leads qualificados.
//
// Suporta múltiplos datasets/tokens (um por cliente/campanha).
// Cada lead pode ter um CAPI config específico via metaCapConfigId.
// Se não tiver, usa o config padrão (isDefault=true).
//
// Fluxo:
//   1. Corretor muda stage do cliente no CRM
//   2. Este módulo busca o CAPI config do cliente
//   3. Envia o evento para o dataset correto da Meta
//   4. Meta usa os dados para otimizar entrega de anúncios
// ============================================================

/**
 * Dados do cliente necessários para o evento.
 */
export interface LeadConversionData {
  clientName: string;
  email: string | null;
  phone: string | null;
  /** ID numérico do lead gerado pela Meta (15-17 dígitos). */
  metaLeadgenId: string | null;
  /** Timestamp UNIX da mudança de stage. */
  eventTime: number;
  /** Novo stage do cliente. */
  stage: string;
  /** ID do CAPI config específico do cliente (se houver). */
  capiConfigId?: string | null;
}

/**
 * CAPI config resolved from database.
 */
interface ResolvedCapConfig {
  id: string;
  accessToken: string;
  datasetId: string;
  enabled: boolean;
  name: string;
}

/**
 * Nome do CRM para o campo lead_event_source.
 */
const CRM_NAME = 'CRM-Pro';

/**
 * Hash SHA256 de um valor. Remove espaços e converte para minúsculas
 * antes de aplicar o hash (requisito da Meta para normalização).
 */
function sha256Hash(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value.trim().toLowerCase())
    .digest('hex');
}

/**
 * Mapeia stages do CRM para nomes de eventos da Meta.
 */
function stageToEventName(stage: string): string {
  const mapping: Record<string, string> = {
    LEAD: 'Lead',
    PROSPECT: 'Prospect',
    VISITA_AGENDADA: 'Visit_Scheduled',
    VISITA_REALIZADA: 'Visit_Completed',
    CARTA_PROPOSTA: 'Proposal_Sent',
    CONTRATO_GERADO: 'Contract_Generated',
    FECHADO_GANHO: 'Purchase',
    FECHADO_PERDIDO: 'Lead_Lost',
  };
  return mapping[stage] || stage;
}

/**
 * Busca o CAPI config correto para um cliente.
 * Ordem de prioridade:
 *   1. Config específico do cliente (metaCapConfigId)
 *   2. Config padrão (isDefault=true)
 *   3. Fallback: config legado do UserSettings (migração)
 *   4. null (CAPI desabilitado)
 */
async function resolveCapConfig(capiConfigId?: string | null): Promise<ResolvedCapConfig | null> {
  const { db } = await import('@/lib/db');

  // 1. Config específico do cliente
  if (capiConfigId) {
    const specific = await db.metaCapConfig.findUnique({
      where: { id: capiConfigId },
    });
    if (specific && specific.enabled) {
      return {
        id: specific.id,
        accessToken: specific.accessToken,
        datasetId: specific.datasetId,
        enabled: true,
        name: specific.name,
      };
    }
  }

  // 2. Config padrão
  const defaultConfig = await db.metaCapConfig.findFirst({
    where: { isDefault: true, enabled: true },
  });
  if (defaultConfig) {
    return {
      id: defaultConfig.id,
      accessToken: defaultConfig.accessToken,
      datasetId: defaultConfig.datasetId,
      enabled: true,
      name: defaultConfig.name,
    };
  }

  // 3. Fallback: config legado do UserSettings
  // Isso permite migração suave sem perder a config existente
  const settings = await db.userSettings.findMany({
    where: {
      key: { in: ['meta_capi_enabled', 'meta_capi_access_token', 'meta_capi_dataset_id'] },
    },
  });
  const map: Record<string, string> = {};
  settings.forEach((s) => { map[s.key] = s.value; });

  if (map['meta_capi_enabled'] === 'true' && map['meta_capi_access_token'] && map['meta_capi_dataset_id']) {
    return {
      id: '__legacy__',
      accessToken: map['meta_capi_access_token'],
      datasetId: map['meta_capi_dataset_id'],
      enabled: true,
      name: 'Configuração Legada',
    };
  }

  return null;
}

/**
 * Envia um evento de conversão do CRM para a Meta via Conversions API.
 *
 * Chamado de forma assíncrona (fire-and-forget) quando o stage de um cliente muda.
 * Nunca lança erro — falhas são apenas logadas para não afetar a UX.
 */
export async function sendLeadConversionEvent(data: LeadConversionData): Promise<void> {
  try {
    const config = await resolveCapConfig(data.capiConfigId);

    if (!config || !config.accessToken || !config.datasetId) {
      return; // CAPI desabilitado ou não configurado
    }

    // Construir user_data com os campos hashados
    const userData: Record<string, unknown> = {};

    // lead_id (prioridade máxima — ID numérico da Meta)
    if (data.metaLeadgenId) {
      const numericId = data.metaLeadgenId.replace(/[^0-9]/g, '');
      if (numericId.length >= 15) {
        userData.lead_id = numericId;
      }
    }

    // Email hashado (SHA256)
    if (data.email) {
      userData.em = [sha256Hash(data.email)];
    }

    // Telefone hashado (SHA256) — normalizar para apenas dígitos
    if (data.phone) {
      const digits = data.phone.replace(/[^0-9]/g, '');
      if (digits.length >= 10) {
        userData.ph = [sha256Hash(digits)];
      }
    }

    // Nome para hash (primeiro nome e sobrenome separadamente)
    if (data.clientName) {
      const parts = data.clientName.trim().split(/\s+/);
      if (parts.length > 1) {
        userData.fn = [sha256Hash(parts[0])];
        userData.ln = [sha256Hash(parts.slice(1).join(' '))];
      } else if (parts.length === 1) {
        userData.fn = [sha256Hash(parts[0])];
      }
    }

    const payload = {
      data: [
        {
          event_name: stageToEventName(data.stage),
          event_time: data.eventTime,
          action_source: 'system_generated',
          custom_data: {
            event_source: 'crm',
            lead_event_source: CRM_NAME,
          },
          user_data: userData,
        },
      ],
    };

    const url = `https://graph.facebook.com/v22.0/${config.datasetId}/events?access_token=${encodeURIComponent(config.accessToken)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[Meta CAPI] Falha ao enviar evento (${data.stage}) para cliente ${data.clientName}` +
        ` [config: ${config.name}]:`,
        `HTTP ${response.status}`, errorText
      );
    } else {
      const result = await response.json();
      const warnings = result.messages?.filter((m: any) => m.type === 'warning');
      if (warnings?.length > 0) {
        console.warn(`[Meta CAPI] Evento enviado com warnings (${data.stage}) [config: ${config.name}]:`, warnings);
      }
      console.log(`[Meta CAPI] Evento enviado: ${stageToEventName(data.stage)} para ${data.clientName}` +
        ` (${data.metaLeadgenId || 'sem lead_id'}) [config: ${config.name}]`);
    }
  } catch (error) {
    console.error('[Meta CAPI] Erro ao enviar evento de conversão:', error);
  }
}

/**
 * Envia um evento de teste para o CAPI.
 * Retorna o resultado da Meta para validação no frontend.
 */
export async function sendTestCapEvent(accessToken: string, datasetId: string): Promise<{ success: boolean; message: string; testEventCode?: string }> {
  try {
    const testEventCode = 'TEST' + Math.floor(Math.random() * 9000 + 1000);

    const testPayload = {
      data: [
        {
          event_name: 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'system_generated',
          event_source_url: 'https://crm-pro-gilt.vercel.app/',
          custom_data: {
            event_source: 'crm',
            lead_event_source: CRM_NAME,
          },
          user_data: {
            em: [sha256Hash('test@crm-pro.teste.com')],
            ph: [sha256Hash('11999999999')],
          },
        },
      ],
      test_event_code: testEventCode,
    };

    const url = `https://graph.facebook.com/v22.0/${datasetId}/events?access_token=${encodeURIComponent(accessToken)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, message: `HTTP ${response.status}: ${errorText}` };
    }

    const result = await response.json();

    if (result.error) {
      return { success: false, message: result.error.message };
    }

    const eventsReceived = result.events_received || 0;
    const warnings = result.messages?.filter((m: any) => m.type === 'warning');

    return {
      success: eventsReceived > 0,
      testEventCode,
      message: eventsReceived > 0
        ? `Evento de teste recebido pela Meta (${eventsReceived} evento${eventsReceived > 1 ? 's' : ''}). Código: ${testEventCode}. ${warnings?.length ? 'Avisos: ' + warnings.map((w: any) => w.message).join('; ') : 'Sem avisos.'}`
        : 'Meta não confirmou recebimento do evento.',
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}

/**
 * Busca um CAPI config que tenha um formId específico.
 * Usado pelo webhook para auto-atribuir configs quando chega um lead.
 *
 * Ordem de busca:
 *   1. lead_form_mappings.capiConfigId (mapeamento manual)
 *   2. meta_cap_configs.formIds (array JSON no config)
 */
export async function findCapConfigByFormId(formId: string): Promise<{ id: string } | null> {
  const { db } = await import('@/lib/db');

  // 1. Buscar mapeamento manual na tabela lead_form_mappings
  try {
    const mapping = await db.leadFormMapping.findFirst({
      where: { formId, capiConfigId: { not: null } },
      select: { capiConfigId: true },
    });
    if (mapping?.capiConfigId) {
      return { id: mapping.capiConfigId };
    }
  } catch {
    // Table might not exist yet during migration
  }

  // 2. Buscar nos formIds (JSON array) dos configs
  const configs = await db.metaCapConfig.findMany({
    where: { enabled: true },
    select: { id: true, formIds: true },
  });

  for (const config of configs) {
    if (!config.formIds) continue;
    try {
      const ids: string[] = JSON.parse(config.formIds);
      if (ids.includes(formId)) {
        return { id: config.id };
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return null;
}
