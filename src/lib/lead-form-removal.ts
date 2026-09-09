// ============================================================
// LEAD FORM REMOVAL — Remoção de formulário aprendido de uma
// conta de anúncios Meta (aba "Formulários" do card da conta).
//
// O QUE É REMOVIDO:
//   1. As linhas LeadFormMapping do formulário ESCOPADAS à conta
//      (formId + adAccountId; adAccountId null = grupo global
//      "sem conta"). Cada linha carrega o roteamento aprendido:
//      fila, config CAPI, empreendimento e contagem de leads.
//   2. O formId dos arrays JSON `formIds` dos MetaCapConfig que
//      o referenciam — sem isso o config continuaria processando
//      eventos de um formulário que não existe mais no painel.
//
// O QUE NUNCA É TOCADO:
//   - Clients (leads) capturados — histórico preservado;
//   - LeadFormScoring (config de Temperatura por formulário tem
//     remoção própria, na aba Temperatura);
//   - MetaCampaignBinding (vínculo campanha→fila é por campaignId).
//
// EFEITO COLATERAL ESPERADO (documentado na UI): se um novo lead
// chegar por este formulário (webhook/polling), o mapeamento é
// reaprendido automaticamente e o formulário volta a aparecer.
// ============================================================

/** Fatia do PrismaClient usada pela remoção (permite teste com fake). */
export interface FormRemovalDb {
  leadFormMapping: {
    deleteMany(args: {
      where: { formId: string; adAccountId?: string | null };
    }): Promise<{ count: number }>;
  };
  metaCapConfig: {
    findMany(args: {
      where: { formIds: { contains: string } };
      select: { id: true; formIds: true };
    }): Promise<Array<{ id: string; formIds: string | null }>>;
    update(args: {
      where: { id: string };
      data: { formIds: string };
    }): Promise<unknown>;
  };
}

export interface RemoveFormMappingArgs {
  /** Meta leadgen form ID. */
  formId: string;
  /** Conta de anúncios dona dos mappings a remover.
   *  string = conta específica; null = grupo global (sem conta). */
  adAccountId: string | null;
}

export interface RemoveFormMappingResult {
  /** Linhas LeadFormMapping efetivamente excluídas. */
  deleted: number;
  /** IDs dos MetaCapConfig cujo formIds JSON foram limpos. */
  cleanedConfigs: string[];
}

/**
 * Remove o formulário de UMA conta (ou do grupo global) e limpa o
 * formId dos arrays formIds dos configs CAPI que o referenciam.
 * A limpeza usa match EXATO com aspas (`"formId"` dentro do JSON)
 * para nunca confundir prefixos (ex.: "123" não casa com "1234").
 */
export async function removeFormMapping(
  db: FormRemovalDb,
  { formId, adAccountId }: RemoveFormMappingArgs
): Promise<RemoveFormMappingResult> {
  // 1. Exclui os mappings do formulário escopados à conta escolhida.
  const result = await db.leadFormMapping.deleteMany({
    where: { formId, adAccountId },
  });

  // 2. Limpa o formId dos arrays formIds dos configs CAPI.
  const cleanedConfigs: string[] = [];
  const configs = await db.metaCapConfig.findMany({
    where: { formIds: { contains: `"${formId}"` } },
    select: { id: true, formIds: true },
  });
  for (const cfg of configs) {
    try {
      const parsed: unknown = JSON.parse(cfg.formIds || '[]');
      if (!Array.isArray(parsed)) continue;
      const next = parsed.filter((id) => id !== formId);
      if (next.length === parsed.length) continue; // não continha de fato
      await db.metaCapConfig.update({
        where: { id: cfg.id },
        data: { formIds: JSON.stringify(next) },
      });
      cleanedConfigs.push(cfg.id);
    } catch {
      // formIds não é JSON válido — deixa intocado (não bloqueia a remoção)
    }
  }

  return { deleted: result.count, cleanedConfigs };
}

/**
 * Mensagem de confirmação da UI (pt-BR) — explicita o que é removido,
 * o que NÃO é apagado (leads) e o comportamento de re-aprendizado.
 */
export function buildFormRemovalConfirmMessage(args: {
  formId: string;
  formName?: string | null;
  totalLeads?: number;
}): string {
  const label = args.formName ? `"${args.formName}" (${args.formId})` : args.formId;
  const leads =
    typeof args.totalLeads === 'number' && args.totalLeads > 0
      ? `\n• Os ${args.totalLeads} lead(s) JÁ capturados por este formulário NÃO são apagados.`
      : '\n• Leads já capturados NÃO são apagados.';
  return (
    `Remover o formulário ${label} desta conta?\n\n` +
    '• O mapeamento aprendido (fila, config CAPI, empreendimento e campanhas) será excluído.' +
    leads +
    '\n• Se um novo lead chegar por este formulário, ele reaparece aqui automaticamente.'
  );
}
