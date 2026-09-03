/**
 * context-schema.ts — Contrato estrito do contexto do Nexo (prompt v2.0 §8/§9).
 *
 * Zod .strict(): rejeita chaves desconhecidas, limita arrays/strings/datas.
 * O contexto chega do cliente como *referência* (IDs + filtros estruturados +
 * sinais não factuais). Nenhum dado factual vem do cliente — tudo que compõe
 * resposta é resolvido no servidor (context-resolver).
 */
import { z } from 'zod';

/** Views que o assistente entende (espelha CRMView; clientDetail mapeia p/ clients + entity). */
export const assistantContextViewSchema = z.enum([
  'dashboard',
  'enterprises',
  'clients',
  'closed-deals',
  'tags',
  'reminders',
  'reports',
  'meta-ads',
  'admin',
  'settings',
]);

export const assistantSubviewSchema = z.enum([
  'default',
  'kanban',
  'analytics',
  'launches',
  'resale',
  'client-detail',
]);

export const reportPeriodSchema = z.enum([
  'weekly',
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
  'custom',
]);

export const contextFiltersSchema = z
  .object({
    stage: z.string().max(40).optional(),
    region: z.string().max(80).optional(),
    tagIds: z.array(z.string().min(1).max(64)).max(20).optional(),
    reportPeriod: reportPeriodSchema.optional(),
    reportFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    reportTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    enterpriseType: z.enum(['LANCAMENTO', 'REVENDA']).optional(),
  })
  .strict();

/** Sinais servem apenas para ordenar sugestões visuais — nunca para fatos. */
export const contextSignalsSchema = z
  .object({
    visibleCount: z.number().int().min(0).max(10_000).optional(),
    pendingReminders: z.number().int().min(0).max(10_000).optional(),
    overdueFollowUps: z.number().int().min(0).max(10_000).optional(),
    todaySchedules: z.number().int().min(0).max(10_000).optional(),
    upcomingSchedules: z.number().int().min(0).max(10_000).optional(),
    tagCount: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const pageContextSchema = z
  .object({
    version: z.literal(1),
    view: assistantContextViewSchema,
    subview: assistantSubviewSchema.optional(),
    entity: z
      .object({
        type: z.enum(['client', 'enterprise']),
        id: z.string().min(1).max(64),
      })
      .strict()
      .optional(),
    filters: contextFiltersSchema.optional(),
    signals: contextSignalsSchema.optional(),
  })
  .strict();

export const assistantLocaleSchema = z.enum(['pt-BR', 'en', 'es']);

export const assistantRequestSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    context: pageContextSchema.optional(),
    locale: assistantLocaleSchema.optional(),
  })
  .strict();

export type AssistantRequest = z.infer<typeof assistantRequestSchema>;
export type AssistantPageContextInput = z.infer<typeof pageContextSchema>;
export type AssistantContextView = z.infer<typeof assistantContextViewSchema>;

/** View inexistente no enum do assistente → fallback seguro. */
export function parsePageContext(raw: unknown): AssistantPageContextInput | null {
  const parsed = pageContextSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
