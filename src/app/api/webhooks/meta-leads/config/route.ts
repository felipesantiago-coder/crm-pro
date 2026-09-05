import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';

/**
 * API de configuração do Meta Ads Integration
 * Endpoint admin-only.
 *
 * CONFIGURAÇÃO POR CONTA: verify token, app secret, page token e o
 * toggle do webhook NÃO existem mais no global — são configurados em
 * cada conta de anúncios (Anúncios Meta > Contas de Anúncio > card da
 * conta). Este endpoint mantém apenas o contador de leads e a
 * configuração GLOBAL opcional de CAPI (Conversions API).
 */

export async function GET() {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const settings = await db.userSettings.findMany({
      where: {
        key: {
          in: [
            'meta_lead_count',
            'meta_capi_enabled',
            'meta_capi_access_token',
            'meta_capi_dataset_id',
          ],
        },
      },
    });

    const map: Record<string, string> = {};
    settings.forEach((s) => {
      map[s.key] = s.value;
    });

    return NextResponse.json({
      leadCount: parseInt(map['meta_lead_count'] || '0', 10),
      // CAPI (Conversions API) — global opcional; por conta no card dela
      capiEnabled: map['meta_capi_enabled'] === 'true',
      hasCapAccessToken: !!map['meta_capi_access_token'],
      capiDatasetId: map['meta_capi_dataset_id'] || '',
      // O frontend preenche a webhookUrl com window.location.origin
    });
  } catch (error) {
    console.error('[Meta Config] Erro ao buscar configurações:', error);
    return NextResponse.json({ error: 'Erro ao buscar configurações' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const body = await request.json();
    const { capiAccessToken, capiDatasetId, capiEnabled } = body;

    if (
      capiAccessToken === undefined &&
      capiDatasetId === undefined &&
      capiEnabled === undefined
    ) {
      return NextResponse.json(
        {
          error:
            'Webhook e polling são configurados POR CONTA (Anúncios Meta > Contas de Anúncio). Este endpoint aceita apenas capiAccessToken/capiDatasetId/capiEnabled.',
        },
        { status: 400 }
      );
    }

    // Upsert cada configuração CAPI individualmente
    const upserts: Promise<unknown>[] = [];

    if (capiAccessToken !== undefined) {
      upserts.push(
        db.userSettings.upsert({
          where: { key: 'meta_capi_access_token' },
          update: { value: String(capiAccessToken).trim() },
          create: { key: 'meta_capi_access_token', value: String(capiAccessToken).trim() },
        })
      );
    }

    if (capiDatasetId !== undefined) {
      upserts.push(
        db.userSettings.upsert({
          where: { key: 'meta_capi_dataset_id' },
          update: { value: String(capiDatasetId).trim() },
          create: { key: 'meta_capi_dataset_id', value: String(capiDatasetId).trim() },
        })
      );
    }

    if (capiEnabled !== undefined) {
      upserts.push(
        db.userSettings.upsert({
          where: { key: 'meta_capi_enabled' },
          update: { value: capiEnabled ? 'true' : 'false' },
          create: { key: 'meta_capi_enabled', value: capiEnabled ? 'true' : 'false' },
        })
      );
    }

    await Promise.all(upserts);

    return NextResponse.json({
      success: true,
      message: 'Configuração CAPI atualizada com sucesso (webhook/polling são por conta)',
    });
  } catch (error) {
    console.error('[Meta Config] Erro ao salvar configurações:', error);
    return NextResponse.json({ error: 'Erro ao salvar configurações' }, { status: 500 });
  }
}