import { z } from 'zod/v4';

// ── Helpers ──
const optionalString = z.string().trim().max(500).optional().nullable();
const optionalStringLong = z.string().trim().max(5000).optional().nullable();

// ── Client ──
export const createClientSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(200, 'Nome muito longo'),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email('E-mail inválido').max(200).optional().nullable().or(z.literal('')),
  region: optionalString,
  enterprise: optionalString,
  enterpriseId: z.string().uuid().optional().nullable(),
  notes: optionalStringLong,
  updatePeriod: z.number().int().min(1).max(365).optional(),
  tagIds: z.array(z.string()).max(20).optional(),
  partnerIds: z.array(z.string()).max(20).optional(),
});

export const updateClientSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email('E-mail inválido').max(200).optional().nullable().or(z.literal('')),
  region: optionalString,
  enterprise: optionalString,
  enterpriseId: z.string().uuid().optional().nullable(),
  notes: optionalStringLong,
  updatePeriod: z.number().int().min(1).max(365).optional(),
  tagIds: z.array(z.string()).max(20).optional(),
});

// ── Interaction ──
export const createInteractionSchema = z.object({
  description: z.string().trim().min(1, 'Descrição é obrigatória').max(5000, 'Descrição muito longa'),
});

// ── Schedule ──
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^\d{2}:\d{2}$/;

export const createScheduleSchema = z.object({
  scheduledDate: z.string().regex(dateRegex, 'Formato de data inválido (YYYY-MM-DD)'),
  scheduledTime: z.string().regex(timeRegex, 'Formato de hora inválido (HH:mm)'),
  description: optionalStringLong,
});

export const updateScheduleSchema = z.object({
  scheduledDate: z.string().regex(dateRegex, 'Formato de data inválido').optional(),
  scheduledTime: z.string().regex(timeRegex, 'Formato de hora inválido').optional(),
  description: optionalStringLong,
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).optional(),
});

// ── Reminder ──
export const createReminderSchema = z.object({
  title: z.string().trim().min(1, 'Título é obrigatório').max(200, 'Título muito longo'),
  description: optionalStringLong,
  dueDate: z.string().min(1, 'Data de vencimento é obrigatória'),
  clientId: z.string().min(1, 'Cliente é obrigatório'),
});

export const updateReminderSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: optionalStringLong,
  dueDate: z.string().min(1).optional(),
  notified: z.boolean().optional(),
});

// ── Tag ──
export const createTagSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(50, 'Nome muito longo'),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (formato #RRGGBB)').optional(),
});

export const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida').optional(),
});

// ── Enterprise ──
export const createEnterpriseSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(200, 'Nome muito longo'),
  region: optionalString,
});

// ── Profile ──
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(100, 'Nome muito longo'),
});

// ── Settings ──
export const updateSettingSchema = z.object({
  key: z.string().trim().min(1, 'Chave é obrigatória').max(100),
  value: z.union([z.string().max(10000), z.number(), z.boolean()]),
});

// ── Portal Reschedule (public) ──
export const portalRescheduleSchema = z.object({
  token: z.string().min(1),
  clientId: z.string().min(1),
  scheduleId: z.string().min(1),
  newDate: z.string().regex(dateRegex, 'Data inválida (YYYY-MM-DD)'),
  newTime: z.string().regex(timeRegex, 'Hora inválida (HH:mm)'),
});

// ── Validation helper ──
export function validateBody<T>(schema: z.ZodType<T>, body: unknown) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join('; ');
    return { data: null, error: message };
  }
  return { data: result.data, error: null };
}
