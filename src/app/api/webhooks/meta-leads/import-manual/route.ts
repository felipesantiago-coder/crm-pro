import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import { notifyNewLead } from '@/lib/telegram';
import { assignLeadToUser } from '@/lib/lead-queue';
import { findCapConfigByFormId } from '@/lib/meta-conversions';
import { getMetaFieldValue, formatMetaPhone, extractCustomAnswers, formatCustomAnswersText } from '@/lib/meta-lead-utils';

// ============================================================
// POST /api/webhooks/meta-leads/import-manual
// Importa leads perdidos manualmente via leadgen_id.
// Usa o Page Access Token (não precisa de ads_read).
//
// Body: { leadgenIds: string[] }
// ============================================================

interface LeadgenData {
  field_data: Array<{ name: string; values: string[] }>;
  ad_id?: string;
  campaign_id?: string;
  form_id?: string;
  created_time?: string;
}

// getFieldValue e formatPhone agora vêm de @/lib/meta-lead-utils

async function fetchLeadFromMeta(leadgenId: string, pageAccessToken: string): Promise<LeadgenData | null> {
  const url = `https://graph.facebook.com/v22.0/${leadgenId}?access_token=${encodeURIComponent(pageAccessToken)}&fields=field_data,ad_id,campaign_id,form_id,created_time`;
  const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Import Manual] Falha ao buscar lead ${leadgenId}: HTTP ${response.status} — ${errorText.slice(0, 300)}`);
    return null;
  }

  const data = await response.json();
  if (!data?.field_data || !Array.isArray(data.field_data)) {
    console.warn(`[Import Manual] lead ${leadgenId} sem field_data`);
    return null;
  }

  return data as LeadgenData;
}

export async function POST(request: NextRequest) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const body = await request.json();
    const { leadgenIds } = body as { leadgenIds?: string[] };

    if (!leadgenIds || !Array.isArray(leadgenIds) || leadgenIds.length === 0) {
      return NextResponse.json({ error: 'Envie um array leadgenIds' }, { status: 400 });
    }

    if (leadgenIds.length > 50) {
      return NextResponse.json({ error: 'Máximo de 50 leads por requisição' }, { status: 400 });
    }

    // Buscar Page Access Token nas configurações
    const settings = await db.userSettings.findMany({
      where: { key: { in: ['meta_page_access_token'] } },
    });
    const pageAccessToken = settings.find(s => s.key === 'meta_page_access_token')?.value;

    if (!pageAccessToken) {
      return NextResponse.json({ error: 'Page Access Token não configurado. Vá em Configurações > Webhook e preencha o campo.' }, { status: 400 });
    }

    // Buscar um admin para createdBy
    const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    let creatorId = admin?.id;
    if (!creatorId) {
      const anyUser = await db.user.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } });
      creatorId = anyUser?.id;
    }
    if (!creatorId) {
      return NextResponse.json({ error: 'Nenhum usuário cadastrado no sistema' }, { status: 400 });
    }

    const results: Array<{
      leadgenId: string;
      success: boolean;
      clientName?: string;
      clientId?: string;
      reason?: string;
      assignedTo?: string;
    }> = [];

    for (const rawId of leadgenIds) {
      const leadgenId = String(rawId).trim();
      if (!leadgenId) continue;

      console.log(`[Import Manual] Processando leadgen_id=${leadgenId}`);

      // 1. Verificar se já foi processado
      try {
        const existing = await db.client.findUnique({ where: { metaLeadgenId: leadgenId }, select: { id: true, name: true } });
        if (existing) {
          results.push({ leadgenId, success: true, clientName: existing.name, clientId: existing.id, reason: 'já_existente' });
          console.log(`[Import Manual] Lead ${leadgenId} já existe (client ${existing.id})`);
          continue;
        }
      } catch (dedupErr) {
        console.warn(`[Import Manual] Falha ao verificar duplicata para ${leadgenId}:`, dedupErr);
      }

      // 2. Buscar dados do lead na Meta
      const leadData = await fetchLeadFromMeta(leadgenId, pageAccessToken);
      if (!leadData) {
        results.push({ leadgenId, success: false, reason: 'Não foi possível buscar dados do lead na Meta. Verifique se o Page Access Token está correto e se o leadgen_id é válido.' });
        continue;
      }

      const fieldData = leadData.field_data;
      const formId = leadData.form_id || '';
      const campaignId = String(leadData.campaign_id || '');

      // 3. Extrair campos
      const rawName = getMetaFieldValue(fieldData, 'full_name')
        || getMetaFieldValue(fieldData, 'name')
        || getMetaFieldValue(fieldData, 'nome')
        || getMetaFieldValue(fieldData, 'nome_completo')
        || 'Lead Meta Ads (importado)';

      const rawEmail = getMetaFieldValue(fieldData, 'email') || getMetaFieldValue(fieldData, 'e_mail') || null;
      const rawPhone = getMetaFieldValue(fieldData, 'phone_number')
        || getMetaFieldValue(fieldData, 'phone')
        || getMetaFieldValue(fieldData, 'celular')
        || getMetaFieldValue(fieldData, 'telefone')
        || null;
      const city = getMetaFieldValue(fieldData, 'city') || getMetaFieldValue(fieldData, 'cidade') || null;

      const name = rawName?.trim() || 'Lead Meta Ads (importado)';
      const email = rawEmail?.trim() || null;
      const phone = formatMetaPhone(rawPhone);
      const region = city?.trim() || null;

      // Extrair respostas customizadas (perguntas extras do formulário)
      const customAnswers = extractCustomAnswers(fieldData);
      const customAnswersText = formatCustomAnswersText(customAnswers);

      // 4. Verificar duplicata por telefone/email
      const existingByContact = await db.client.findFirst({
        where: {
          OR: [
            ...(phone ? [{ phone }] : []),
            ...(email ? [{ email }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingByContact) {
        // Atualizar metaLeadgenId no cliente existente para evitar re-import
        await db.client.update({
          where: { id: existingByContact.id },
          data: { metaLeadgenId: leadgenId, lastInteractionAt: new Date() },
        }).catch(() => {});

        // Criar interação com respostas do formulário
        await db.interaction.create({
          data: {
            clientId: existingByContact.id,
            description: `[Meta Ads] Lead ${leadgenId} importado manualmente. Dados: ${email ? `Email: ${email}` : ''}${phone ? ` | Telefone: ${phone}` : ''}${region ? ` | Cidade: ${region}` : ''}.${customAnswersText}`,
          },
        });

        // Tentar atribuir à fila
        let assignedTo: string | undefined;
        try {
          const assignResult = await assignLeadToUser({ leadId: existingByContact.id, source: 'meta_ads:import_manual' });
          if (assignResult.assigned) {
            assignedTo = assignResult.userName;
            await db.client.update({ where: { id: existingByContact.id }, data: { createdBy: assignResult.userId! } }).catch(() => {});
          }
        } catch {}

        results.push({ leadgenId, success: true, clientName: existingByContact.name, clientId: existingByContact.id, reason: 'cliente_existente_atualizado', assignedTo });
        console.log(`[Import Manual] Lead ${leadgenId} vinculado ao cliente existente ${existingByContact.id}`);
        continue;
      }

      // 5. Buscar CAPI config
      let capiConfigId: string | undefined;
      if (formId) {
        try {
          const capiMatch = await findCapConfigByFormId(formId);
          if (capiMatch) capiConfigId = capiMatch.id;
        } catch {}
      }

      // 6. Criar cliente
      try {
        const newClient = await db.client.create({
          data: {
            name,
            email: email || undefined,
            phone: phone || undefined,
            region: region || undefined,
            stage: 'LEAD',
            updatePeriod: 1,
            createdBy: creatorId,
            metaLeadgenId: leadgenId,
            metaCapConfigId: capiConfigId,
            notes: `[Meta Ads] Lead importado manualmente.\nLead ID: ${leadgenId}${formId ? `\nForm ID: ${formId}` : ''}${campaignId ? `\nCampaign ID: ${campaignId}` : ''}${leadData.created_time ? `\nCriado em: ${leadData.created_time}` : ''}${customAnswersText}`,
          },
        });

        await db.interaction.create({
          data: {
            clientId: newClient.id,
            description: `[Meta Ads] Lead importado manualmente via leadgen_id. Origem: Facebook/Instagram Lead Ads.${customAnswersText}`,
          },
        });

        // 7. Atribuir à fila
        let assignedTo: string | undefined;
        let assignedUserId: string | undefined;
        try {
          const assignResult = await assignLeadToUser({ leadId: newClient.id, source: 'meta_ads:import_manual' });
          if (assignResult.assigned && assignResult.userId) {
            assignedTo = assignResult.userName;
            assignedUserId = assignResult.userId;
            await db.client.update({
              where: { id: newClient.id },
              data: { createdBy: assignResult.userId, utmSource: 'meta_ads', utmCampaign: 'import_manual' },
            }).catch(() => {});
          }
        } catch (queueErr) {
          console.error(`[Import Manual] Falha na fila para ${newClient.id}:`, queueErr);
        }

        // 8. Notificação Telegram
        const notifyId = assignedUserId || creatorId;
        if (notifyId) {
          db.user.findUnique({ where: { id: notifyId }, select: { telegramChatId: true, name: true } }).then((user) => {
            if (user?.telegramChatId) {
              notifyNewLead(user.telegramChatId, {
                leadName: newClient.name,
                leadPhone: newClient.phone || '',
                leadEmail: newClient.email || '',
                enterpriseName: undefined,
                utmCampaign: 'import_manual',
                utmSource: 'meta_ads',
                slug: undefined,
                assignedUserName: assignedTo,
                customAnswers,
              }).catch(() => {});
            }
          }).catch(() => {});
        }

        results.push({ leadgenId, success: true, clientName: name, clientId: newClient.id, assignedTo });
        console.log(`[Import Manual] ✅ Lead ${leadgenId} importado como client ${newClient.id} (${name})`);
      } catch (createErr) {
        console.error(`[Import Manual] Erro ao criar cliente para lead ${leadgenId}:`, createErr);
        results.push({ leadgenId, success: false, clientName: name, reason: 'Erro ao criar cliente no banco' });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);

    console.log(`[Import Manual] Resumo: ${succeeded}/${results.length} com sucesso`);

    return NextResponse.json({
      imported: succeeded,
      total: results.length,
      results,
      message: `${succeeded} lead${succeeded !== 1 ? 's' : ''} importado${succeeded !== 1 ? 's' : ''} com sucesso${failed.length > 0 ? `, ${failed.length} falha(s)` : ''}`,
    });
  } catch (error) {
    console.error('[Import Manual] Erro:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
