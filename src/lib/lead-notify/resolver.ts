/**
 * Resolução de contexto: determina empreendimento e imagem do cartão
 * usando a precedência de vínculos EXPLÍCITOS (precedence.ts) e a regra
 * de imagem do §9.4:
 *
 *   1. imagem principal aprovada (Enterprise.imageUrl), se válida;
 *   2. senão, primeira imagem válida da galeria (EnterpriseImage.sortOrder);
 *   3. nunca imagem de outro empreendimento;
 *   4. sem imagem → conteúdo textual + diagnóstico enterprise_image_missing;
 *   5. falha de mídia nunca bloqueia cadastro nem atribuição do lead.
 *
 * Falhas de DB são degradadas com console.warn (sem PII) — a notificação
 * continua como texto, o lead nunca é perdido por causa da imagem.
 */

import { db } from '@/lib/db';
import type { ResolvedEnterprise } from './types';
import { selectEnterpriseByPrecedence, type PrecedenceInput } from './precedence';

const HTTP_URL_PATTERN = /^https?:\/\//i;

function isValidImageUrl(url: string | null | undefined): url is string {
  return !!url && HTTP_URL_PATTERN.test(url.trim()) && url.trim().length <= 2048;
}

/**
 * Carrega empreendimento + imagem aplicando a regra principal → galeria.
 * `explicitName` evita segunda consulta quando o chamador já tem o nome.
 */
async function loadEnterpriseWithImage(
  enterpriseId: string,
  source: ResolvedEnterprise['source'],
  explicitName?: string | null,
): Promise<ResolvedEnterprise> {
  const diagnostics: string[] = [];

  try {
    const enterprise = await db.enterprise.findUnique({
      where: { id: enterpriseId },
      select: {
        name: true,
        imageUrl: true,
        images: {
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: { url: true, altText: true },
        },
      },
    });

    if (!enterprise) {
      diagnostics.push('enterprise_not_found');
      return { name: '', source: 'none', imageAlt: '', diagnostics };
    }

    const main = isValidImageUrl(enterprise.imageUrl) ? enterprise.imageUrl.trim() : null;
    const gallery = enterprise.images[0]?.url;
    const galleryUrl = isValidImageUrl(gallery) ? gallery.trim() : null;

    if (!main && galleryUrl) {
      diagnostics.push('enterprise_main_image_missing');
    }

    const imageUrl = main || galleryUrl || undefined;
    if (!imageUrl) diagnostics.push('enterprise_image_missing');

    return {
      enterpriseId,
      name: explicitName || enterprise.name,
      imageUrl,
      imageAlt: enterprise.images[0]?.altText || explicitName || enterprise.name,
      source,
      diagnostics,
    };
  } catch (err) {
    console.warn(
      '[Lead Notify] Falha ao carregar empreendimento — notificação segue sem imagem:',
      err instanceof Error ? err.message : err,
    );
    return { name: '', source: 'none', imageAlt: '', diagnostics: ['enterprise_lookup_failed'] };
  }
}

/**
 * Resolve o empreendimento do lead seguindo a precedência §9.1.
 * Recebe os identificadores disponíveis no fluxo de ingestão; nunca usa
 * similaridade de nome. Retorna null quando não há vínculo — o cartão
 * sai sem imagem e com texto neutro, sem inventar informação.
 */
export async function resolveLeadEnterprise(input: {
  explicit?: PrecedenceInput['explicit'];
  adId?: string | null;
  formId?: string | null;
  campaignId?: string | null;
  clientId?: string | null;
}): Promise<ResolvedEnterprise | null> {
  const precedenceInput: PrecedenceInput = { explicit: input.explicit };

  // Nível 0: explícito — ainda precisa carregar nome/imagem
  if (input.explicit?.enterpriseId) {
    const resolved = await loadEnterpriseWithImage(
      input.explicit.enterpriseId,
      'explicit',
      input.explicit.name,
    );
    return resolved.name ? resolved : null;
  }

  // Nível 1: MetaAdBinding por adId
  if (input.adId) {
    try {
      const binding = await db.metaAdBinding.findUnique({
        where: { adId: input.adId },
        select: { enterpriseId: true },
      });
      precedenceInput.adBinding = binding ?? null;
    } catch (err) {
      console.warn(
        '[Lead Notify] ad_binding lookup falhou (migration pendente?):',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Nível 2: LeadFormMapping do par (formId, campaignId)
  if (input.formId && input.campaignId) {
    try {
      const mapping = await db.leadFormMapping.findFirst({
        where: { formId: input.formId, campaignId: input.campaignId, enterpriseId: { not: null } },
        select: { enterpriseId: true },
      });
      precedenceInput.formCampaignMapping = mapping ?? null;
    } catch (err) {
      console.warn(
        '[Lead Notify] form_campaign lookup falhou:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Nível 3: MetaCampaignBinding por campaignId
  if (input.campaignId) {
    try {
      const binding = await db.metaCampaignBinding.findUnique({
        where: { campaignId: input.campaignId },
        select: { enterpriseId: true },
      });
      precedenceInput.campaignBinding = binding ?? null;
    } catch (err) {
      console.warn(
        '[Lead Notify] campaign_binding lookup falhou:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Nível 4: mappings do formId (ids distintos → seletor detecta ambiguidade)
  if (input.formId) {
    try {
      const mappings = await db.leadFormMapping.findMany({
        where: { formId: input.formId, enterpriseId: { not: null } },
        select: { enterpriseId: true },
        distinct: ['enterpriseId'],
      });
      precedenceInput.formMappingEnterpriseIds = mappings
        .map((m) => m.enterpriseId)
        .filter((id): id is string => !!id);
    } catch (err) {
      console.warn(
        '[Lead Notify] form_mapping lookup falhou:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Nível 5: associação persistida no cliente
  if (input.clientId) {
    try {
      const client = await db.client.findUnique({
        where: { id: input.clientId },
        select: { enterpriseId: true },
      });
      precedenceInput.clientEnterpriseId = client?.enterpriseId ?? null;
    } catch (err) {
      console.warn(
        '[Lead Notify] client lookup falhou:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const outcome = selectEnterpriseByPrecedence(precedenceInput);

  if (!outcome.enterpriseId) {
    if (outcome.diagnostics.length > 0) {
      console.warn('[Lead Notify] Resolução de empreendimento:', outcome.diagnostics.join('; '));
    }
    return null;
  }

  const resolved = await loadEnterpriseWithImage(outcome.enterpriseId, outcome.source);
  resolved.diagnostics.push(...outcome.diagnostics);

  return resolved.name ? resolved : null;
}
