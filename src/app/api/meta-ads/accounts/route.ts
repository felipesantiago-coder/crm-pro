import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import { getAdAccountInfo } from '@/lib/meta-ads-service';
import { z } from 'zod';

const accountSchema = z.object({
  label: z.string().min(1, 'Label obrigatório'),
  adAccountId: z.string().min(1, 'ID da conta obrigatório'),
  accessToken: z.string().min(10, 'Token inválido'),
  pageAccessToken: z.string().optional(),
});

// GET — List all ad accounts
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const accounts = await db.metaAdAccount.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        adAccountId: true,
        isActive: true,
        lastSyncedAt: true,
        createdAt: true,
        updatedAt: true,
        pageAccessToken: true,
      },
    });
    // Never expose the actual token; return hasPageAccessToken boolean
    const mapped = accounts.map((a) => ({
      id: a.id,
      label: a.label,
      adAccountId: a.adAccountId,
      isActive: a.isActive,
      lastSyncedAt: a.lastSyncedAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      hasPageAccessToken: !!a.pageAccessToken,
    }));
    return NextResponse.json({ accounts: mapped });
  } catch (err) {
    console.error('[META-ADS-ACCOUNTS] Erro ao listar:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// POST — Create a new ad account
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await request.json();
    const parsed = accountSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || 'Dados inválidos';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { label, adAccountId, accessToken, pageAccessToken } = parsed.data;

    // Validate token by fetching account info
    let accountInfo;
    try {
      accountInfo = await getAdAccountInfo(accessToken, adAccountId);
    } catch (err: any) {
      return NextResponse.json(
        { error: `Token inválido ou sem acesso à conta: ${err.message}` },
        { status: 400 },
      );
    }

    // Use Meta's account name as fallback label
    const finalLabel = label || accountInfo.name || adAccountId;

    const account = await db.metaAdAccount.upsert({
      where: { adAccountId },
      create: {
        label: finalLabel,
        adAccountId,
        accessToken,
        pageAccessToken: pageAccessToken || null,
        lastSyncedAt: new Date(),
      },
      update: {
        label: finalLabel,
        accessToken,
        pageAccessToken: pageAccessToken || null,
        lastSyncedAt: new Date(),
      },
    });

    return NextResponse.json({
      message: `Conta "${finalLabel}" conectada com sucesso`,
      account: {
        id: account.id,
        label: account.label,
        adAccountId: account.adAccountId,
        isActive: account.isActive,
        lastSyncedAt: account.lastSyncedAt,
        hasPageAccessToken: !!account.pageAccessToken,
        metaName: accountInfo.name,
        businessName: accountInfo.businessName,
        accountStatus: accountInfo.accountStatus,
        balance: accountInfo.balance,
        currency: accountInfo.currency,
      },
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return NextResponse.json(
        { error: 'Esta conta de anúncio já está cadastrada' },
        { status: 409 },
      );
    }
    console.error('[META-ADS-ACCOUNTS] Erro ao criar:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// PATCH — Toggle active status, update label, or update pageAccessToken
export async function PATCH(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await request.json();
    const { id, isActive, label, pageAccessToken } = body as {
      id: string;
      isActive?: boolean;
      label?: string;
      pageAccessToken?: string;
    };

    if (!id) {
      return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 });
    }

    const data: any = { updatedAt: new Date() };
    if (typeof isActive === 'boolean') data.isActive = isActive;
    if (label) data.label = label;
    if (pageAccessToken !== undefined) data.pageAccessToken = pageAccessToken || null;

    const account = await db.metaAdAccount.update({
      where: { id },
      data,
      select: {
        id: true,
        label: true,
        adAccountId: true,
        isActive: true,
        lastSyncedAt: true,
      },
    });

    return NextResponse.json({ account });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
    }
    console.error('[META-ADS-ACCOUNTS] Erro ao atualizar:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// DELETE — Remove an ad account
export async function DELETE(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 });
    }

    await db.metaAdAccount.delete({ where: { id } });
    return NextResponse.json({ message: 'Conta removida' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
    }
    console.error('[META-ADS-ACCOUNTS] Erro ao deletar:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
