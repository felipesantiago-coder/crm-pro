/**
 * Precedência OBRIGATÓRIA do vínculo anúncio/formulário/campanha →
 * empreendimento (§9.1 do prompt mestre):
 *
 *   1. vínculo explícito por adId              (MetaAdBinding)
 *   2. vínculo form+campaign                   (LeadFormMapping com campaignId)
 *   3. vínculo por campaignId                  (MetaCampaignBinding)
 *   4. vínculo por formId sem ambiguidade      (LeadFormMapping do formId)
 *   5. associação já persistida no cliente     (Client.enterpriseId)
 *   6. nenhuma associação
 *
 * Correspondência textual por NOME de anúncio nunca decide a imagem em
 * produção — só pode sugerir associação ao administrador (§9.1). Vínculo
 * ambíguo não escolhe nada silenciosamente: cai para o nível seguinte
 * com diagnóstico, e a mensagem sai sem imagem de empreendimento errada.
 *
 * Função PURA: o resolver.ts busca os candidatos no DB e chama esta
 * seleção — assim a precedência é testável sem banco.
 */

import type { EnterpriseBindingSource } from './types';

export interface PrecedenceInput {
  /** Empreendimento já resolvido pelo chamador (landing/recuperação/teste). */
  explicit?: { enterpriseId?: string | null; name?: string | null } | null;
  /** MetaAdBinding por adId (nível 1). */
  adBinding?: { enterpriseId: string | null } | null;
  /** LeadFormMapping do par (formId, campaignId) (nível 2). */
  formCampaignMapping?: { enterpriseId: string | null } | null;
  /** MetaCampaignBinding por campaignId (nível 3). */
  campaignBinding?: { enterpriseId: string | null } | null;
  /** enterpriseIds DISTINTOS entre os mappings do formId (nível 4). */
  formMappingEnterpriseIds?: string[];
  /** Associação persistida no cliente (nível 5). */
  clientEnterpriseId?: string | null;
}

export interface PrecedenceOutcome {
  enterpriseId: string | null;
  source: EnterpriseBindingSource;
  ambiguous: boolean;
  diagnostics: string[];
}

function firstBinding(
  binding: { enterpriseId: string | null } | null | undefined,
): string | null {
  return binding?.enterpriseId || null;
}

export function selectEnterpriseByPrecedence(
  input: PrecedenceInput,
): PrecedenceOutcome {
  const diagnostics: string[] = [];

  // Nível 0: explícito do chamador (landing por slug, recuperação, teste)
  if (input.explicit?.enterpriseId) {
    return {
      enterpriseId: input.explicit.enterpriseId,
      source: 'explicit',
      ambiguous: false,
      diagnostics,
    };
  }

  // Nível 1: vínculo por anúncio
  const ad = firstBinding(input.adBinding);
  if (ad) {
    return { enterpriseId: ad, source: 'ad_binding', ambiguous: false, diagnostics };
  }

  // Nível 2: vínculo form+campanha
  const formCampaign = firstBinding(input.formCampaignMapping);
  if (formCampaign) {
    return {
      enterpriseId: formCampaign,
      source: 'form_campaign_mapping',
      ambiguous: false,
      diagnostics,
    };
  }

  // Nível 3: vínculo por campanha
  const campaign = firstBinding(input.campaignBinding);
  if (campaign) {
    return {
      enterpriseId: campaign,
      source: 'campaign_binding',
      ambiguous: false,
      diagnostics,
    };
  }

  // Nível 4: vínculo por formulário, apenas SEM ambiguidade
  const formIds = (input.formMappingEnterpriseIds || []).filter(Boolean);
  const distinct = [...new Set(formIds)];
  if (distinct.length === 1) {
    return {
      enterpriseId: distinct[0],
      source: 'form_mapping',
      ambiguous: false,
      diagnostics,
    };
  }
  if (distinct.length > 1) {
    diagnostics.push('enterprise_binding_ambiguous:form');
  }

  // Nível 5: associação persistida no cliente/evento
  if (input.clientEnterpriseId) {
    return {
      enterpriseId: input.clientEnterpriseId,
      source: 'client',
      ambiguous: distinct.length > 1,
      diagnostics,
    };
  }

  // Nível 6: nenhuma associação — mensagem sai sem imagem de empreendimento
  return { enterpriseId: null, source: 'none', ambiguous: distinct.length > 1, diagnostics };
}
