/**
 * context-resolver.ts — Resolução e autorização do contexto no servidor
 * (prompt v2.0 §9.2/§9.3).
 *
 * Garantias:
 *  - clientId reutiliza a mesma política de canAccessClient (criador, parceiros, ADMIN).
 *  - enterpriseId segue a visibilidade real do projeto (catálogo compartilhado
 *    de empreendimentos — leitura autenticada).
 *  - meta-ads/admin exigem papel ADMIN.
 *  - Fatos (contagens, listas) vêm SEMPRE do banco — sinais do cliente nunca
 *    compõem resposta factual.
 *  - Nenhuma chamada HTTP interna; consultas diretas e pequenas.
 */
import { db } from '@/lib/db';

export interface ResolvedEntity {
  type: 'client' | 'enterprise';
  id: string;
  /** Rótulo seguro (sem ID) para exibir na resposta. */
  label: string;
  /** Bloco de dados autorizados para o modelo (não confiável — delimitado). */
  facts?: string;
}

export interface ResolvedContext {
  view: string;
  viewLabel: string;
  entity?: ResolvedEntity;
  /** Bloco de fatos derivados da view/filtros (ex.: distribuição por estágio). */
  facts?: string;
  warnings: Array<'partial_data' | 'stale_context'>;
}

async function canAccessClient(clientId: string, userId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const client = await db.client.findFirst({
    where: {
      id: clientId,
      OR: [{ createdBy: userId }, { partners: { some: { userId } } }],
    },
    select: { id: true },
  });
  return !!client;
}

const STAGE_LABELS: Record<string, string> = {
  LEAD: 'Lead', PROSPECT: 'Prospect',
  VISITA_AGENDADA: 'Visita Agendada', VISITA_REALIZADA: 'Visita Realizada',
  CARTA_PROPOSTA: 'Carta Proposta', CONTRATO_GERADO: 'Contrato Gerado',
  FECHADO_GANHO: 'Fechado e Ganho', FECHADO_PERDIDO: 'Fechado e Perdido',
};

function summarizeClient(client: {
  name: string; stage: string; region: string | null; enterprise: string | null;
  notes: string | null; updatePeriod: number; lastInteractionAt: Date | null;
  tags: Array<{ tag: { name: string } }>;
  interactions: Array<{ description: string; createdAt: Date }>;
  schedules: Array<{ scheduledDate: Date; scheduledTime: string | null; status: string; description: string | null }>;
  reminders: Array<{ title: string; dueDate: Date; notified: boolean }>;
}): string {
  const lines: string[] = [];
  lines.push(`Nome: ${client.name}`);
  lines.push(`Estágio: ${STAGE_LABELS[client.stage] ?? client.stage}`);
  if (client.region) lines.push(`Região: ${client.region}`);
  if (client.enterprise) lines.push(`Empresa/Empreendimento: ${client.enterprise}`);
  if (client.tags.length > 0) lines.push(`Tags: ${client.tags.map((t) => t.tag.name).join(', ')}`);
  lines.push(`Período de atualização: ${client.updatePeriod} dias`);
  if (client.lastInteractionAt) {
    lines.push(`Última interação: ${new Date(client.lastInteractionAt).toLocaleDateString('pt-BR')}`);
  }
  if (client.notes) lines.push(`Notas registradas: ${client.notes.substring(0, 300)}`);

  if (client.interactions.length > 0) {
    lines.push(`Interações recentes (amostra de ${client.interactions.length}):`);
    for (const i of client.interactions.slice(0, 8)) {
      lines.push(`- ${new Date(i.createdAt).toLocaleDateString('pt-BR')} | ${i.description.substring(0, 120)}`);
    }
  } else {
    lines.push('Interações: nenhuma registrada.');
  }

  const pending = client.schedules.filter((s) => s.status === 'PENDING');
  if (pending.length > 0) {
    lines.push(`Agendamentos pendentes (amostra de ${pending.length}):`);
    for (const s of pending.slice(0, 5)) {
      lines.push(`- ${new Date(s.scheduledDate).toLocaleDateString('pt-BR')} ${s.scheduledTime ?? ''} | ${s.description ?? ''}`);
    }
  }
  const openReminders = client.reminders.filter((r) => !r.notified);
  if (openReminders.length > 0) {
    lines.push(`Lembretes abertos (amostra de ${openReminders.length}):`);
    for (const r of openReminders.slice(0, 5)) {
      lines.push(`- ${new Date(r.dueDate).toLocaleDateString('pt-BR')} | ${r.title}`);
    }
  }
  return lines.join('\n');
}

/** Fatos de período (relatórios) — consultas diretas, agregadas no servidor. */
async function resolveReportFacts(
  userId: string,
  isAdmin: boolean,
  filters: { reportPeriod?: string; reportFrom?: string; reportTo?: string; stage?: string },
): Promise<string> {
  const now = new Date();
  let from: Date;
  const to = new Date(now.getTime() + 24 * 3600 * 1000);
  switch (filters.reportPeriod) {
    case 'weekly': from = new Date(now.getTime() - 7 * 24 * 3600 * 1000); break;
    case 'quarterly': from = new Date(now.getTime() - 90 * 24 * 3600 * 1000); break;
    case 'semiannual': from = new Date(now.getTime() - 182 * 24 * 3600 * 1000); break;
    case 'annual': from = new Date(now.getTime() - 365 * 24 * 3600 * 1000); break;
    case 'custom': {
      const parsedFrom = filters.reportFrom ? new Date(`${filters.reportFrom}T00:00:00`) : null;
      const parsedTo = filters.reportTo ? new Date(`${filters.reportTo}T23:59:59`) : null;
      if (!parsedFrom || Number.isNaN(parsedFrom.getTime())) {
        from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      } else {
        from = parsedFrom;
        if (parsedTo && !Number.isNaN(parsedTo.getTime())) to.setTime(parsedTo.getTime());
      }
      break;
    }
    default: from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  }

  const userFilter = isAdmin ? {} : {
    OR: [{ createdBy: userId }, { partners: { some: { userId } } }],
  };

  const [stageGroups, wonCount, lostCount] = await Promise.all([
    db.client.groupBy({
      by: ['stage'],
      where: { ...userFilter, createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    }),
    db.client.count({ where: { ...userFilter, stage: 'FECHADO_GANHO', updatedAt: { gte: from, lte: to } } }),
    db.client.count({ where: { ...userFilter, stage: 'FECHADO_PERDIDO', updatedAt: { gte: from, lte: to } } }),
  ]);

  const lines = [`Período analisado: ${from.toLocaleDateString('pt-BR')} a ${to.toLocaleDateString('pt-BR')}.`];
  if (stageGroups.length > 0) {
    lines.push('Clientes criados no período por estágio:');
    for (const g of stageGroups.sort((a, b) => b._count._all - a._count._all)) {
      lines.push(`- ${STAGE_LABELS[g.stage] ?? g.stage}: ${g._count._all}`);
    }
  } else {
    lines.push('Nenhum cliente criado no período.');
  }
  lines.push(`Negócios fechados como ganhos no período: ${wonCount}.`);
  lines.push(`Negócios fechados como perdidos no período: ${lostCount}.`);
  if (filters.stage) {
    lines.push(`Filtro de estágio ativo: ${STAGE_LABELS[filters.stage] ?? filters.stage}.`);
  }
  lines.push('Observação: trata-se de amostra agregada do período, não de todo o histórico.');
  return lines.join('\n');
}

export interface ResolveContextInput {
  context: {
    view: string;
    entity?: { type: 'client' | 'enterprise'; id: string };
    filters?: {
      stage?: string;
      region?: string;
      tagIds?: string[];
      reportPeriod?: string;
      reportFrom?: string;
      reportTo?: string;
      enterpriseType?: string;
    };
  } | null;
  userId: string;
  isAdmin: boolean;
  viewLabels: Record<string, string>;
}

/**
 * Autoriza cada ID recebido e produz fatos do banco. Nenhum dado de outro
 * usuário/empresa entra no resultado — acesso negado degrada para
 * contexto só de view (sem erro, sem vazamento).
 */
export async function resolveContext(input: ResolveContextInput): Promise<ResolvedContext> {
  const { context, userId, isAdmin, viewLabels } = input;
  const warnings: ResolvedContext['warnings'] = [];

  if (!context) {
    return { view: 'dashboard', viewLabel: viewLabels.dashboard ?? 'Dashboard', warnings };
  }

  const resolved: ResolvedContext = {
    view: context.view,
    viewLabel: viewLabels[context.view] ?? context.view,
    warnings,
  };

  // Entidade: autorizar antes de qualquer consulta de conteúdo.
  if (context.entity?.type === 'client') {
    const allowed = await canAccessClient(context.entity.id, userId, isAdmin);
    if (allowed) {
      const client = await db.client.findUnique({
        where: { id: context.entity.id },
        select: {
          id: true,
          name: true, stage: true, region: true, enterprise: true, notes: true,
          updatePeriod: true, lastInteractionAt: true,
          tags: { select: { tag: { select: { name: true } } } },
          interactions: {
            where: {}, orderBy: { createdAt: 'desc' as const }, take: 10,
            select: { description: true, createdAt: true },
          },
          schedules: {
            orderBy: { scheduledDate: 'desc' as const }, take: 12,
            select: { scheduledDate: true, scheduledTime: true, status: true, description: true },
          },
          reminders: {
            orderBy: { dueDate: 'asc' as const }, take: 8,
            select: { title: true, dueDate: true, notified: true },
          },
        },
      });
      if (client) {
        resolved.entity = {
          type: 'client',
          id: client.id ?? context.entity.id,
          label: 'cliente selecionado',
          facts: summarizeClient(client),
        };
      } else {
        warnings.push('stale_context');
      }
    } else {
      // Sem acesso: não revela existência nem dados — só degrada o rótulo.
      warnings.push('stale_context');
      resolved.entity = { type: 'client', id: '', label: 'cliente selecionado (indisponível)' };
    }
  } else if (context.entity?.type === 'enterprise') {
    // Catálogo compartilhado: leitura autenticada permitida para qualquer usuário.
    const enterprise = await db.enterprise.findUnique({
      where: { id: context.entity.id },
      select: { id: true, name: true, type: true, region: true, pdfContent: true, cachedInfo: true },
    });
    if (enterprise) {
      let facts = '';
      const info = enterprise.cachedInfo;
      if (info && typeof info === 'object' && 'resumo' in (info as Record<string, unknown>)) {
        facts += String((info as Record<string, unknown>).resumo ?? '').substring(0, 1200);
      } else if (enterprise.pdfContent) {
        facts = enterprise.pdfContent.substring(0, 4000);
      }
      resolved.entity = {
        type: 'enterprise',
        id: enterprise.id,
        label: 'empreendimento selecionado',
        facts: [
          `Nome: ${enterprise.name}`,
          `Tipo: ${enterprise.type}`,
          enterprise.region ? `Região: ${enterprise.region}` : '',
          facts ? `Dados documentados (amostra):\n${facts}` : 'Sem documentação detalhada registrada.',
        ].filter(Boolean).join('\n'),
      };
    } else {
      warnings.push('stale_context');
      resolved.entity = { type: 'enterprise', id: '', label: 'empreendimento selecionado (indisponível)' };
    }
  }

  // Fatos de período para relatórios (sempre do banco).
  if (context.view === 'reports') {
    try {
      resolved.facts = await resolveReportFacts(userId, isAdmin, context.filters ?? {});
    } catch (err) {
      console.error('[AI ASSISTANT] Report facts failed:', err);
      warnings.push('partial_data');
    }
  }

  return resolved;
}
