import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';

/**
 * API de configuração do Meta Ads Integration
 * Endpoint admin-only para gerenciar as configurações do webhook.
 */

export async function GET() {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const settings = await db.userSettings.findMany({
      where: {
        key: {
          in: [
            'meta_webhook_verify_token',
            'meta_app_secret',
            'meta_webhook_enabled',
            'meta_lead_count',
            'meta_page_access_token',
          ],
        },
      },
    });

    const map: Record<string, string> = {};
    settings.forEach((s) => {
      map[s.key] = s.value;
    });

    return NextResponse.json({
      enabled: map['meta_webhook_enabled'] === 'true',
      hasVerifyToken: !!map['meta_webhook_verify_token'],
      hasAppSecret: !!map['meta_app_secret'],
      hasPageAccessToken: !!map['meta_page_access_token'],
      leadCount: parseInt(map['meta_lead_count'] || '0', 10),
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
    const { verifyToken, appSecret, pageAccessToken, enabled } = body;

    // Upsert cada configuração individualmente
    const upserts = [];

    if (verifyToken !== undefined) {
      upserts.push(
        db.userSettings.upsert({
          where: { key: 'meta_webhook_verify_token' },
          update: { value: String(verifyToken).trim() },
          create: { key: 'meta_webhook_verify_token', value: String(verifyToken).trim() },
        })
      );
    }

    if (appSecret !== undefined) {
      upserts.push(
        db.userSettings.upsert({
          where: { key: 'meta_app_secret' },
          update: { value: String(appSecret).trim() },
          create: { key: 'meta_app_secret', value: String(appSecret).trim() },
        })
      );
    }

    if (pageAccessToken !== undefined) {
      upserts.push(
        db.userSettings.upsert({
          where: { key: 'meta_page_access_token' },
          update: { value: String(pageAccessToken).trim() },
          create: { key: 'meta_page_access_token', value: String(pageAccessToken).trim() },
        })
      );
    }

    if (enabled !== undefined) {
      upserts.push(
        db.userSettings.upsert({
          where: { key: 'meta_webhook_enabled' },
          update: { value: enabled ? 'true' : 'false' },
          create: { key: 'meta_webhook_enabled', value: enabled ? 'true' : 'false' },
        })
      );
    }

    await Promise.all(upserts);

    return NextResponse.json({
      success: true,
      message: 'Configurações do Meta Ads atualizadas com sucesso',
    });
  } catch (error) {
    console.error('[Meta Config] Erro ao salvar configurações:', error);
    return NextResponse.json({ error: 'Erro ao salvar configurações' }, { status: 500 });
  }
}