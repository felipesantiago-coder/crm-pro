import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  resolvePublicEnterpriseInfo,
  mergePublicInfoWithCatalog,
} from '@/lib/ai/enterprise-info';
import enterprisesCatalog from '@/data/enterprises-catalog';

/**
 * GET /api/enterprises/public-list — listagem pública (seção /empreendimentos).
 *
 * CORREÇÃO (2026-09, "seção pública com valores desatualizados"):
 * esta rota foi esquecida no refactor Fase 5 — não consumia a cadeia
 * publicado → verificado → legado e NÃO devolvia info alguma extraída
 * (publishedInfo/verifiedInfo/cachedInfo). O cartão da listagem, que espera
 * `cachedInfo` (resumo/status), recaindo sempre em `landingSubtitle` — campo
 * curado MANUALMENTE no painel e que NENHUM fluxo de extração/publicação
 * atualiza. Resultado: após publicar uma base nova (ex.: Villa Bianco com
 * preço novo), o cartão continuava exibindo o valor antigo indefinidamente.
 * Não era cache temporal — era fonte de dados desconectada.
 *
 * Agora a listagem usa o MESMO resolver das demais superfícies públicas
 * (§12): publicado → verificado → legado, com fallback do catálogo estático
 * apenas para campos nulos. A info resolvida é exposta em `cachedInfo`
 * (camada de compatibilidade) + `infoSource` para telemetria. Rascunho de
 * extração NUNCA é público.
 */

function resolveI18nString(field: Record<string, string> | null | undefined, locale: string): string | null {
  if (!field || typeof field !== 'object') return null;
  return field[locale] || field['pt-BR'] || Object.values(field)[0] || null;
}

export async function GET(request: NextRequest) {
  try {
    const locale = request.headers.get('x-locale') || 'pt-BR';

    const enterprises = await db.enterprise.findMany({
      where: { slug: { not: null } },
      select: {
        id: true,
        name: true,
        slug: true,
        region: true,
        imageUrl: true,
        landingTitle: true,
        landingSubtitle: true,
        images: {
          select: { id: true, url: true, altText: true, sortOrder: true },
          orderBy: { sortOrder: 'asc' },
          take: 1,
        },
        cachedInfo: true,
        cachedInfoI18n: true,
        publishedInfo: true,
        publishedAt: true,
        publishedVersion: true,
        verifiedInfo: true,
        verifiedInfoAt: true,
      },
      orderBy: { name: 'asc' },
    });

    // Resolve i18n fields to flat strings for the listing page
    const resolved = enterprises.map((e) => {
      const { cachedInfoI18n, publishedInfo, verifiedInfo, ...listItem } = e;

      // ── §12: mesma cadeia pública das demais superfícies ──
      const publicInfo = resolvePublicEnterpriseInfo(e);

      let info: Record<string, unknown> | null = publicInfo.info as Record<string, unknown> | null;

      // Fallback do catálogo estático apenas para campos nulos (idêntico às
      // demais superfícies) — o valor do banco SEMPRE vence quando existe.
      const catalog = e.slug ? enterprisesCatalog[e.slug] : undefined;
      if (catalog) {
        info = mergePublicInfoWithCatalog(info, catalog);
      }

      // i18n: tradução do locale mesclada sobre a base (idêntico à landing)
      if (locale !== 'pt-BR' && cachedInfoI18n && (cachedInfoI18n as Record<string, Record<string, unknown>>)[locale]) {
        info = { ...(info || {}), ...(cachedInfoI18n as Record<string, Record<string, unknown>>)[locale] };
      }

      return {
        ...listItem,
        landingTitle: resolveI18nString(e.landingTitle as Record<string, string> | null, locale),
        landingSubtitle: resolveI18nString(e.landingSubtitle as Record<string, string> | null, locale),
        cachedInfo: info,
        infoSource: publicInfo.source,
        infoReferenceDate: publicInfo.referenceDate,
      };
    });

    return NextResponse.json(resolved);
  } catch (error) {
    console.error('[Enterprise Public List] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
