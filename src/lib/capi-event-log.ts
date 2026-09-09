// ============================================================
// CAPI Event Log — auditoria dos envios à Conversions API.
//
// sendLeadConversionEvent é fire-and-forget: falhas iam apenas para
// console.error no servidor, invisíveis para o admin. Este módulo
// persiste cada tentativa (sent/failed/skipped) na tabela capi_event_logs
// para exibição no painel Meta Ads (aba CAPI global).
//
// Princípios:
//   - logCapiSend NUNCA lança/propaga erro — logging não pode quebrar
//     o fluxo de conversão (o banco pode nem ter a tabela durante
//     migrações parciais).
//   - Snapshots denormalizados (capiConfigName/clientName) preservam
//     a auditoria mesmo após exclusão do config ou do cliente.
//   - Prune oportunista: cada escrita remove registros > 30 dias
//     (volume de stage changes é baixo; um deleteMany indexado é barato
//     e mantém a tabela pequena sem job externo).
// ============================================================

/** Prazo de retenção dos logs de envio (dias). */
export const CAPI_LOG_RETENTION_DAYS = 30;

export type CapiLogStatus = 'sent' | 'failed' | 'skipped';

export interface CapiLogEntry {
  status: CapiLogStatus;
  capiConfigId?: string | null;
  capiConfigName?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  eventName?: string | null;
  stage?: string | null;
  /** Detalhe do erro (failed/skipped) ou resumo da resposta (sent). */
  errorMessage?: string | null;
  metaResponse?: string | null;
}

/** Limite de caracteres por campo de texto livre do log. */
export const CAPI_LOG_TEXT_MAX = 500;

/**
 * Monta a mensagem de erro persistida para uma falha HTTP na Graph API.
 * Trunca o corpo para CAPI_LOG_TEXT_MAX (respostas da Meta podem ser longas
 * HTML/JSON e não cabem inteiras no log).
 * Pura — testável.
 */
export function buildCapiLogErrorMessage(httpStatus: number, bodySnippet: unknown): string {
  const body =
    typeof bodySnippet === 'string'
      ? bodySnippet
      : bodySnippet != null
        ? JSON.stringify(bodySnippet)
        : '';
  const trimmed = body.length > CAPI_LOG_TEXT_MAX ? body.slice(0, CAPI_LOG_TEXT_MAX) + '…' : body;
  return `HTTP ${httpStatus}${trimmed ? `: ${trimmed}` : ''}`;
}

/**
 * Extrai um resumo legível da resposta de SUCESSO do endpoint /events
 * (events_received + warnings síncronos). Pura — testável.
 */
export function parseCapiSendOutcome(result: unknown): string {
  const r = (result ?? {}) as {
    events_received?: unknown;
    messages?: Array<{ type?: unknown; message?: unknown }>;
  };
  const received = typeof r.events_received === 'number' ? r.events_received : null;
  const warnings = Array.isArray(r.messages)
    ? r.messages.filter((m) => m && m.type === 'warning' && typeof m.message === 'string')
    : [];
  const base =
    received != null
      ? `${received} evento${received === 1 ? '' : 's'} recebido${received === 1 ? '' : 's'} pela Meta`
      : 'Resposta sem events_received';
  return warnings.length
    ? `${base}; avisos: ${warnings.map((w) => w.message).join('; ')}`
    : base;
}

/**
 * Tempo relativo em pt-BR para exibição na lista de atividade.
 * Pura — testável (now injetável).
 */
export function timeAgoPt(dateIso: string, now: Date = new Date()): string {
  const then = new Date(dateIso);
  if (isNaN(then.getTime())) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return 'agora mesmo';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days} d`;
  const months = Math.floor(days / 30);
  return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
}

/**
 * Persiste uma tentativa de envio CAPI. Best-effort: engole qualquer erro
 * (incluindo P2021 "tabela não existe" durante janelas de migração) para
 * nunca interferir no fluxo fire-and-forget de conversão.
 */
export async function logCapiSend(entry: CapiLogEntry): Promise<void> {
  try {
    const { db } = await import('@/lib/db');
    const clip = (v?: string | null) =>
      v == null ? null : v.length > CAPI_LOG_TEXT_MAX ? v.slice(0, CAPI_LOG_TEXT_MAX) + '…' : v;

    await db.capiEventLog.create({
      data: {
        status: entry.status,
        capiConfigId: entry.capiConfigId ?? null,
        capiConfigName: clip(entry.capiConfigName ?? null),
        clientId: entry.clientId ?? null,
        clientName: clip(entry.clientName ?? null),
        eventName: entry.eventName ?? null,
        stage: entry.stage ?? null,
        errorMessage: clip(entry.errorMessage ?? null),
        metaResponse: clip(entry.metaResponse ?? null),
      },
    });

    // Prune oportunista — mantém a tabela pequena sem cron externo.
    const cutoff = new Date(Date.now() - CAPI_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await db.capiEventLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  } catch {
    // Logging nunca pode quebrar o envio (ou a ausência dele).
  }
}
