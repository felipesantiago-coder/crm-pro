// ============================================================
// track-ingest — Fase 6 (tracking/relatórios, otimização Vercel)
//
// Limites e sanitização do /api/track (endpoint PÚBLICO do pixel):
//  - limite de corpo por bytes (Content-Length + tamanho real lido);
//  - limite de quantidade de eventos por lote (sendBeacon legítimo
//    envia 1 evento por request — MAX_QUEUE_SIZE do pixel é 50);
//  - validação de tamanho de strings (URLs, UTM, ids) e de metadata
//    (JSON serializado) — eventos válidos NÃO são perdidos por campo
//    gigante: strings são cortadas e metadata estourada vira marcador
//    de truncamento (com lead_id preservado para o link identify);
//  - particionamento do lote em chunks com escrita concorrente
//    limitada (chunks sequenciais, concorrência interna por chunk).
//
// Contratos preservados do /api/track: mapeamento snake_case→camelCase
// do pixel, captura de campos extras em metadata, filtro de eventos
// válidos (visitorId + siteId string), identify por metadata.lead_id.
//
// Puro (sem import de db) — DI estrutural nas funções de escrita.
import type { Prisma } from '@prisma/client';
// ============================================================

/** Limite de corpo por request (64 KB — pixel legítimo usa ≪ disso). */
export const TRACK_MAX_BODY_BYTES = 64 * 1024;

/** Limite de eventos por lote (pixel: 1/request, fila ≤ 50). */
export const TRACK_MAX_EVENTS_PER_BATCH = 100;

/** Tamanho máximo de id (visitorId/sessionId/siteId/eventType). */
export const TRACK_MAX_ID_LENGTH = 128;

/** Tamanho máximo de URL (pageUrl/referrer — padrão de URL). */
export const TRACK_MAX_URL_LENGTH = 2048;

/** Tamanho máximo de eventName/utm*. */
export const TRACK_MAX_SHORT_LENGTH = 256;

/** Tamanho máximo da metadata serializada (coluna Json). */
export const TRACK_MAX_METADATA_BYTES = 8 * 1024;

/** Tamanho de cada chunk de escrita (concorrência interna por onda). */
export const TRACK_WRITE_CHUNK_SIZE = 10;

export interface TrackingEventPayload {
  visitorId: string;
  sessionId: string;
  siteId: string;
  eventType: string;
  eventName: string | null;
  pageUrl: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  metadata: Record<string, unknown> | undefined;
  /** lead_id extraído da metadata (identify) ANTES de qualquer truncamento. */
  identifyLeadId: string | null;
}

export interface NormalizeStats {
  received: number;
  kept: number;
  truncatedMetadata: number;
}

function capString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function capId(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, TRACK_MAX_ID_LENGTH) : '';
}

/**
 * Serializa e limita a metadata. Estourou o teto → marcador de
 * truncamento (`_truncated` + contagem de chaves originais). Campos
 * pequenos de negócio (lead_id) já foram extraídos antes — o link
 * identify nunca é perdido por metadata grande.
 */
function capMetadata(
  metadata: Record<string, unknown> | undefined,
): { metadata: Record<string, unknown> | undefined; truncated: boolean } {
  if (!metadata || Object.keys(metadata).length === 0) {
    return { metadata: undefined, truncated: false };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(metadata);
  } catch {
    // metadata não serializável (ciclo/BigInt vindo do JSON.parse é
    // impossível, mas defesa barata) → descarta o conteúdo
    return { metadata: { _truncated: true, _keys: 1 }, truncated: true };
  }
  if (serialized.length <= TRACK_MAX_METADATA_BYTES) {
    return { metadata, truncated: false };
  }
  return {
    metadata: { _truncated: true, _keys: Object.keys(metadata).length },
    truncated: true,
  };
}

/** Campos já mapeados para colunas — o resto vira metadata (contrato do pixel). */
const MAPPED_FIELDS = new Set([
  'visitorId', 'vid', 'sessionId', 'sid', 'siteId', 'site_id',
  'eventType', 'event', 'eventName', 'event_name', 'pageUrl', 'url',
  'referrer', 'utmSource', 'utm_source', 'utmMedium', 'utm_medium',
  'utmCampaign', 'utm_campaign', 'utmContent', 'utm_content', 'utmTerm', 'utm_term',
  'metadata', 'cookie_consent',
]);

/**
 * Normaliza UM evento cru do pixel (snake_case ou camelCase) para o
 * payload com limites aplicados. Retorna null se o evento não tiver
 * o mínimo (visitorId/siteId strings) — mesmo contrato de isValidPayload.
 */
export function normalizeTrackingEvent(raw: unknown): TrackingEventPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const payload: TrackingEventPayload = {
    visitorId: capId(r.visitorId ?? r.vid),
    sessionId: capId(r.sessionId ?? r.sid),
    siteId: capId(r.siteId ?? r.site_id),
    eventType: capId(r.eventType ?? r.event) || 'pageview',
    eventName: capString(r.eventName ?? r.event_name, TRACK_MAX_SHORT_LENGTH),
    pageUrl: capString(r.pageUrl ?? r.url, TRACK_MAX_URL_LENGTH),
    referrer: capString(r.referrer, TRACK_MAX_URL_LENGTH),
    utmSource: capString(r.utmSource ?? r.utm_source, TRACK_MAX_SHORT_LENGTH),
    utmMedium: capString(r.utmMedium ?? r.utm_medium, TRACK_MAX_SHORT_LENGTH),
    utmCampaign: capString(r.utmCampaign ?? r.utm_campaign, TRACK_MAX_SHORT_LENGTH),
    utmContent: capString(r.utmContent ?? r.utm_content, TRACK_MAX_SHORT_LENGTH),
    utmTerm: capString(r.utmTerm ?? r.utm_term, TRACK_MAX_SHORT_LENGTH),
    metadata: undefined,
    identifyLeadId: null,
  };

  if (!payload.visitorId || !payload.siteId) return null;

  // metadata: 1) sub-objeto explícito; 2) campos restantes do pixel
  const meta: Record<string, unknown> = {};
  if (r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)) {
    Object.assign(meta, r.metadata as Record<string, unknown>);
  }
  for (const key of Object.keys(r)) {
    if (!MAPPED_FIELDS.has(key) && r[key] !== undefined && r[key] !== null) {
      meta[key] = r[key];
    }
  }

  // lead_id para o link identify — extraído ANTES do truncamento
  const rawLeadId = typeof meta.lead_id === 'string' ? meta.lead_id : null;
  payload.identifyLeadId = rawLeadId ? rawLeadId.slice(0, TRACK_MAX_ID_LENGTH) : null;

  const capped = capMetadata(Object.keys(meta).length > 0 ? meta : undefined);
  payload.metadata = capped.metadata;
  return payload;
}

/**
 * Normaliza um lote cru (array ou evento único), aplicando o teto de
 * quantidade de eventos. Retorna os payloads válidos + estatísticas.
 */
export function normalizeBatch(
  body: unknown,
  maxEvents: number = TRACK_MAX_EVENTS_PER_BATCH,
): { events: TrackingEventPayload[]; stats: NormalizeStats } {
  const rawEvents: unknown[] = Array.isArray(body) ? body : [body];
  const received = rawEvents.length;
  const sliced = rawEvents.slice(0, maxEvents);

  const events: TrackingEventPayload[] = [];
  let truncatedMetadata = 0;
  for (const raw of sliced) {
    const normalized = normalizeTrackingEvent(raw);
    if (normalized) {
      if (normalized.metadata?._truncated === true) truncatedMetadata++;
      events.push(normalized);
    }
  }
  return { events, stats: { received, kept: events.length, truncatedMetadata } };
}

/**
 * Particiona o lote em chunks de tamanho fixo. Os chunks são processados
 * SEQUENCIALMENTE (um Promise.all por chunk) — limita a escrita
 * concorrente independente do tamanho do lote.
 */
export function partitionBatch<T>(items: T[], chunkSize: number = TRACK_WRITE_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  const size = Number.isFinite(chunkSize) && chunkSize >= 1 ? Math.floor(chunkSize) : TRACK_WRITE_CHUNK_SIZE;
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// ── Escrita (DI estrutural sobre a fatia do PrismaClient usada —
// mesmo padrão do MetaIngestDb/AssignDb: shapes exatos, Json como
// unknown, bivariância de métodos, zero casts) ──

export interface TrackingWriteDb {
  trackingVisitor: {
    upsert(args: {
      where: { visitorId: string };
      create: {
        visitorId: string;
        siteId: string;
        ip: string;
        userAgent: string | null;
        country: null;
        city: null;
      };
      update: { ip: string; userAgent: string | null };
    }): Promise<unknown>;
    update(args: {
      where: { visitorId: string };
      data: { leadId: string };
    }): Promise<unknown>;
  };
  trackingEvent: {
    create(args: {
      data: {
        visitorId: string;
        sessionId: string;
        siteId: string;
        eventType: string;
        eventName?: string | null;
        pageUrl?: string | null;
        referrer?: string | null;
        utmSource?: string | null;
        utmMedium?: string | null;
        utmCampaign?: string | null;
        utmContent?: string | null;
        utmTerm?: string | null;
        metadata?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined;
      };
    }): Promise<unknown>;
  };
}

export interface BatchWriteResult {
  written: number;
  failed: number;
}

/**
 * Escreve o lote particionado: visitor upsert (sem geo — geo entra
 * async depois) → event create → link identify. Concurrência limitada
 * por chunk; falha de um evento não interrompe os demais (o catch do
 * chunk marca failed e segue — resposta parcial_error é decidida pela
 * rota quando failed > 0 e written === 0, como hoje).
 */
export async function writeEventBatch(
  events: TrackingEventPayload[],
  deps: { db: TrackingWriteDb; ip: string; userAgent: string | null; chunkSize?: number },
): Promise<BatchWriteResult> {
  const { db, ip, userAgent, chunkSize } = deps;
  const chunks = partitionBatch(events, chunkSize);
  let written = 0;
  let failed = 0;

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (event) => {
        try {
          await db.trackingVisitor.upsert({
            where: { visitorId: event.visitorId },
            create: {
              visitorId: event.visitorId,
              siteId: event.siteId,
              ip,
              userAgent,
              country: null,
              city: null,
            },
            update: { ip, userAgent },
          });

          await db.trackingEvent.create({
            data: {
              visitorId: event.visitorId,
              sessionId: event.sessionId,
              siteId: event.siteId,
              eventType: event.eventType,
              eventName: event.eventName,
              pageUrl: event.pageUrl,
              referrer: event.referrer,
              utmSource: event.utmSource,
              utmMedium: event.utmMedium,
              utmCampaign: event.utmCampaign,
              utmContent: event.utmContent,
              utmTerm: event.utmTerm,
              // Cast de fronteira ÚNICO e seguro: metadata vem SEMPRE de
              // JSON.parse (payload do pixel) ou do marcador _truncated —
              // é JSON válido por construção, então satisfaz InputJsonValue.
              metadata: event.metadata as Prisma.InputJsonValue | undefined,
            },
          });

          if (event.eventType === 'identify' && event.identifyLeadId) {
            await db.trackingVisitor.update({
              where: { visitorId: event.visitorId },
              data: { leadId: event.identifyLeadId },
            });
          }
          written++;
        } catch {
          failed++;
        }
      }),
    );
  }
  return { written, failed };
}
