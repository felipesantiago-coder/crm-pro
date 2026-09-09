/**
 * capi-delete-confirm.ts — Mensagem de confirmação de EXCLUSÃO (não só
 * desvinculação) de um config CAPI (MetaCapConfig). Compartilhada pela
 * aba CAPI do card da conta e pelo painel global, para que o admin
 * entenda o impacto antes de confirmar.
 *
 * Impacto real da exclusão (onDelete: SetNull + cadeia resolveCapConfig):
 *   - Clientes com metaCapConfigId → null (perdem a associação)
 *   - LeadFormMapping.capiConfigId → null (vínculos de formulários removidos)
 *   - Novos leads passam a usar a cadeia de fallback:
 *       config específico → config PADRÃO (isDefault) → legado UserSettings → null
 *   - Se o config excluído era o PADRÃO, não sobra fallback padrão até que
 *     outro config seja marcado como padrão (ou exista legado ativo).
 */

export interface CapiDeleteContext {
  /** Nome do config (ex: "Felipe - Pixel") */
  name: string;
  /** Nº de leads/clientes vinculados via metaCapConfigId (_count.clients) */
  clientsCount?: number;
  /** Se o config é o PADRÃO (fallback global da cadeia) */
  isDefault?: boolean;
}

const FALLBACK_TEXT = 'voltará a usar o config CAPI padrão ou o token legado da conta';
const FALLBACK_TEXT_PLURAL = 'voltarão a usar o config CAPI padrão ou o token legado da conta';

export function buildCapiDeleteConfirmMessage({
  name,
  clientsCount,
  isDefault,
}: CapiDeleteContext): string {
  const parts: string[] = [`Excluir o config CAPI "${name}" permanentemente?`];

  if (typeof clientsCount === 'number' && clientsCount > 0) {
    parts.push(
      clientsCount === 1
        ? `1 lead vinculado perderá a associação e ${FALLBACK_TEXT}.`
        : `${clientsCount} leads vinculados perderão a associação e ${FALLBACK_TEXT_PLURAL}.`
    );
  } else {
    parts.push(`Leads vinculados (se houver) perderão a associação e ${FALLBACK_TEXT_PLURAL}.`);
  }

  if (isDefault) {
    parts.push(
      'ATENÇÃO: este é o config PADRÃO (fallback global). Após a exclusão, leads sem config específico ficarão sem envio CAPI até que outro config seja marcado como padrão (ou exista config legado ativo em Configurações).'
    );
  }

  parts.push('Vínculos de formulários com este config também serão removidos. Esta ação não pode ser desfeita.');

  return parts.join(' ');
}
