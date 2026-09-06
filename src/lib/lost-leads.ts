/**
 * lost-leads.ts — Helpers puros da "rede de segurança" de leads perdidos
 * (capturas de beacon/retry que não completaram o cadastro).
 *
 * Sem IA, sem banco e sem rede — funções determinísticas usadas pelas
 * rotas de /api/leads/lost-leads (GET lista, DELETE em lote).
 */
import type { Prisma } from '@prisma/client';

export interface LostLeadFilterOptions {
  /**
   * Quando false (padrão), abrange apenas pendentes (isRecovered: false).
   * Quando true, abrange TUDO — pendentes e recuperados.
   */
  showRecovered?: boolean;
  /** Restringe ao slug do empreendimento (landing page). Vazio = todos. */
  slug?: string | null;
}

/**
 * Monta o filtro Prisma compartilhado entre GET (listagem/paginação) e
 * DELETE em lote (apagar todos). O `total` devolvido pelo GET usa o MESMO
 * where — logo, o escopo anunciado no confirm da UI é exatamente o escopo
 * apagado pelo DELETE ?all=true.
 */
export function buildLostLeadWhere({
  showRecovered = false,
  slug,
}: LostLeadFilterOptions): Prisma.LostLeadWhereInput {
  const where: Prisma.LostLeadWhereInput = { isRecovered: showRecovered ? undefined : false };
  if (slug) where.slug = slug;
  return where;
}

/**
 * Descrição legível do escopo de deleção em lote — usada no confirm da UI
 * e nas mensagens de toast, para que o admin saiba exatamente o que será
 * apagado antes de confirmar.
 */
export function describeLostLeadScope({
  showRecovered = false,
  slug,
}: LostLeadFilterOptions): string {
  const partes: string[] = ['pendentes'];
  if (slug) partes.push(`do slug "${slug}"`);
  if (showRecovered) partes.push('incluindo recuperados');
  return partes.join(' ');
}
