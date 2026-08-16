import crypto from 'crypto';

// ============================================================
// Meta Conversions API (CAPI) — CRM Integration
// Envia eventos de mudança de stage do CRM de volta para a Meta
// para otimização de leads qualificados.
//
// Fluxo:
//   1. Corretor muda stage do cliente no CRM
//   2. Este módulo envia o evento para a Meta via CAPI
//   3. Meta usa os dados para otimizar entrega de anúncios
// ============================================================

/**
 * Configurações do CAPI armazenadas no banco (userSettings).
 */
interface CapiConfig {
  enabled: boolean;
  accessToken: string | null;
  datasetId: string | null;
}

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
 * Recupera as configurações do CAPI do banco de dados.
 */
async function getCapConfig(): Promise<CapiConfig> {
  const { db } = await import('@/lib/db');
  const settings = await db.userSettings.findMany({
    where: {
      key: {
        in: ['meta_capi_enabled', 'meta_capi_access_token', 'meta_capi_dataset_id'],
      },
    },
  });

  const map: Record<string, string> = {};
  settings.forEach((s) => { map[s.key] = s.value; });

  return {
    enabled: map['meta_capi_enabled'] === 'true',
    accessToken: map['meta_capi_access_token'] || null,
    datasetId: map['meta_capi_dataset_id'] || null,
  };
}

/**
 * Mapeia stages do CRM para nomes de eventos da Meta.
 * A Meta recomenda usar nomes descritivos para cada estágio crítico.
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
 * Envia um evento de conversão do CRM para a Meta via Conversions API.
 *
 * Chamado de forma assíncrona (fire-and-forget) quando o stage de um cliente muda.
 * Nunca lança erro — falhas são apenas logadas para não afetar a UX.
 */
export async function sendLeadConversionEvent(data: LeadConversionData): Promise<void> {
  try {
    const config = await getCapConfig();

    if (!config.enabled || !config.accessToken || !config.datasetId) {
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

    const url = `https://graph.facebook.com/v26.0/${config.datasetId}/events?access_token=${encodeURIComponent(config.accessToken)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[Meta CAPI] Falha ao enviar evento (${data.stage}) para cliente ${data.clientName}:`,
        `HTTP ${response.status}`, errorText
      );
    } else {
      const result = await response.json();
      // Meta retorna { messages: [...] } com possíveis warnings
      const warnings = result.messages?.filter((m: any) => m.type === 'warning');
      if (warnings?.length > 0) {
        console.warn(`[Meta CAPI] Evento enviado com warnings (${data.stage}):`, warnings);
      }
      console.log(`[Meta CAPI] Evento enviado: ${stageToEventName(data.stage)} para ${data.clientName} (${data.metaLeadgenId || 'sem lead_id'})`);
    }
  } catch (error) {
    console.error('[Meta CAPI] Erro ao enviar evento de conversão:', error);
  }
}

/**
 * Envia um evento de teste para o CAPI.
 * Retorna o resultado da Meta para validação no frontend.
 */
export async function sendTestCapEvent(accessToken: string, datasetId: string): Promise<{ success: boolean; message: string }> {
  try {
    const testPayload = {
      data: [
        {
          event_name: 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'system_generated',
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
      test_event_code: 'TEST' + Math.floor(Math.random() * 9000 + 1000),
    };

    const url = `https://graph.facebook.com/v26.0/${datasetId}/events?access_token=${encodeURIComponent(accessToken)}`;

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
      message: eventsReceived > 0
        ? `Evento de teste recebido pela Meta (${eventsReceived} evento${eventsReceived > 1 ? 's' : ''}). ${warnings?.length ? 'Avisos: ' + warnings.map((w: any) => w.message).join('; ') : 'Sem avisos.'}`
        : 'Meta não confirmou recebimento do evento.',
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}
