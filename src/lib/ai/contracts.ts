/**
 * contracts.ts — Contratos estruturados das capacidades do Nexo
 * (prompt Implementação Funcionalidades IA v1.0 §8.2/§9.2).
 *
 * Todo resultado de capacidade generativa é validado no servidor com Zod
 * antes de persistir ou expor à UI. O tipo TypeScript NÃO é a garantia —
 * é apenas a derivação estática do schema.
 *
 * Status canônicos:
 *  - complete: saída integralmente validada e utilizável.
 *  - partial: saída utilizável com lacunas declaradas em `limitations`.
 *  - review_required: saída exige revisão humana (ex.: extração com conflitos).
 *  - insufficient_data: insumo insuficiente — nada foi inventado.
 */
import { z } from 'zod';

// ── NexoResult (envelope comum) ─────────────────────────────────────────────

export const NEXO_RESULT_STATUSES = [
  'complete',
  'partial',
  'review_required',
  'insufficient_data',
] as const;

export type NexoResultStatus = (typeof NEXO_RESULT_STATUSES)[number];

export const nexoEvidenceSchema = z.object({
  sourceType: z.enum(['crm_record', 'document', 'calculated_metric']),
  sourceId: z.string().max(128).optional(),
  label: z.string().min(1).max(200),
  excerpt: z.string().max(300).optional(),
  page: z.number().int().positive().optional(),
});

export type NexoEvidence = z.infer<typeof nexoEvidenceSchema>;

export const nexoActionSchema = z.object({
  type: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  requiresConfirmation: z.boolean(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type NexoAction = z.infer<typeof nexoActionSchema>;

export function buildNexoResultSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    status: z.enum(NEXO_RESULT_STATUSES),
    data: dataSchema,
    evidence: z.array(nexoEvidenceSchema).max(64).default([]),
    limitations: z.array(z.string().max(300)).max(16).default([]),
    generatedAt: z.string().datetime({ offset: true }),
    dataVersion: z.string().max(80),
    promptVersion: z.string().max(40),
    actions: z.array(nexoActionSchema).max(8).default([]),
  });
}

// ── Resumo do cliente (Fase 2) ──────────────────────────────────────────────

export const clientBriefSchema = z.object({
  summary: z.string().min(1).max(4000),
  risks: z
    .array(
      z.object({
        label: z.string().min(1).max(160),
        evidence: z.string().min(1).max(400),
        sourceId: z.string().max(128).optional(),
      }),
    )
    .max(5)
    .default([]),
  pendingItems: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        sourceId: z.string().max(128).optional(),
      }),
    )
    .max(8)
    .default([]),
  suggestedQuestions: z.array(z.string().min(1).max(200)).max(4).default([]),
  suggestedActions: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        actionType: z.enum(['OPEN_CHAT', 'DRAFT_REMINDER', 'OPEN_SCHEDULE', 'LIST_PENDENCIES']),
        rationale: z.string().min(1).max(300),
        requiresConfirmation: z.boolean(),
      }),
    )
    .max(3)
    .default([]),
  limitations: z.array(z.string().max(300)).max(6).default([]),
});

export type ClientBrief = z.infer<typeof clientBriefSchema>;

// ── Fatos do CRM renderizados sem IA (Fase 2 §9.1) ─────────────────────────

export interface ClientFacts {
  stage: string;
  stageLabel: string;
  ownerName: string | null;
  lastInteractionAt: string | null;
  nextAppointmentAt: string | null;
  pendingRemindersCount: number;
  pendingSchedulesCount: number;
  totalInteractions: number;
  lastSummaryAt: string | null;
  hasNewDataSinceSummary: boolean;
}

// ── Extração de empreendimentos (Fase 3) ────────────────────────────────────

export const EXTRACTION_FIELD_STATUSES = [
  'found',
  'missing',
  'conflicting',
  'needs_review',
  'accepted',
  'edited',
  'rejected',
] as const;

export type ExtractionFieldStatus = (typeof EXTRACTION_FIELD_STATUSES)[number];

/** Campos críticos exigem decisão individual (prompt §10.6). */
export const CRITICAL_EXTRACTION_FIELDS = [
  'price',
  'deliveryDate',
  'status',
  'apartmentTypes',
] as const;

export const extractionEvidenceSchema = z.object({
  page: z.number().int().positive().nullable().default(null),
  excerpt: z.string().max(300),
  blockIndex: z.number().int().nonnegative().default(0),
});

export const extractionCandidateSchema = z.object({
  field: z.string().min(1).max(80),
  value: z.unknown(),
  status: z.enum(EXTRACTION_FIELD_STATUSES),
  method: z.enum(['ai', 'rule', 'human']),
  confidence: z.number().min(0).max(1).nullable().default(null),
  evidence: z.array(extractionEvidenceSchema).max(4).default([]),
  note: z.string().max(300).nullable().default(null),
});

export type ExtractionCandidate = z.infer<typeof extractionCandidateSchema>;

/** Blocos parciais (por chunk) — saída do modelo por bloco. */
export const blockExtractionSchema = z.object({
  location: z
    .object({
      address: z.string().max(300).nullable(),
      neighborhood: z.string().max(160).nullable(),
      city: z.string().max(120).nullable(),
      state: z.string().max(80).nullable(),
      region: z.string().max(120).nullable(),
      additionalInfo: z.string().max(300).nullable(),
    })
    .default({
      address: null, neighborhood: null, city: null, state: null, region: null, additionalInfo: null,
    }),
  builder: z.string().max(200).nullable().default(null),
  architecture: z.string().max(200).nullable().default(null),
  landscaping: z.string().max(200).nullable().default(null),
  status: z.enum(['Lançamento', 'Em Construção', 'Entregue']).nullable().default(null),
  deliveryDate: z.string().max(120).nullable().default(null),
  price: z.string().max(160).nullable().default(null),
  totalUnits: z.number().int().nonnegative().nullable().default(null),
  floors: z.number().int().nonnegative().nullable().default(null),
  parkingSpots: z.number().int().nonnegative().nullable().default(null),
  differentials: z.array(z.string().max(80)).max(10).default([]),
  apartmentTypes: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        area: z.string().max(40).nullable().default(null),
        bedrooms: z.string().max(60).nullable().default(null),
        description: z.string().max(400).nullable().default(null),
        price: z.string().max(160).nullable().default(null),
      }),
    )
    .max(12)
    .default([]),
  summary: z.string().max(300).nullable().default(null),
});

export type BlockExtraction = z.infer<typeof blockExtractionSchema>;

/** Estrutura de info de empreendimento (mesma forma do legado cachedInfo). */
export const enterpriseInfoSchema = z.object({
  location: z.object({
    address: z.string().nullable(),
    neighborhood: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    region: z.string().nullable(),
    additionalInfo: z.string().nullable(),
  }),
  builder: z.string().nullable(),
  architecture: z.string().nullable(),
  landscaping: z.string().nullable(),
  status: z.string().nullable(),
  deliveryDate: z.string().nullable(),
  price: z.string().nullable(),
  totalUnits: z.number().int().nonnegative().nullable(),
  floors: z.number().int().nonnegative().nullable(),
  parkingSpots: z.number().int().nonnegative().nullable(),
  differentials: z.array(z.string()),
  apartmentTypes: z.array(
    z.object({
      name: z.string(),
      area: z.string().nullable(),
      bedrooms: z.string().nullable(),
      description: z.string().nullable(),
      price: z.string().nullable(),
    }),
  ),
  summary: z.string().nullable(),
});

export type EnterpriseInfo = z.infer<typeof enterpriseInfoSchema>;
