import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = await params;
    const enterprise = await db.enterprise.findUnique({
      where: { id },
      include: {
        _count: { select: { clients: true } },
      },
    });

    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    return NextResponse.json(enterprise);
  } catch (error) {
    console.error('Erro ao buscar empreendimento:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, region } = body;

    const enterprise = await db.enterprise.findUnique({ where: { id } });
    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) {
        return NextResponse.json({ error: 'Nome não pode ser vazio.' }, { status: 400 });
      }
      updateData.name = trimmed;
    }
    if (region !== undefined) {
      updateData.region = region?.trim() || null;
    }

    const updated = await db.enterprise.update({
      where: { id },
      data: updateData,
      include: {
        _count: { select: { clients: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar empreendimento:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = await params;

    // 1. Clean up images from Supabase Storage before deleting DB records
    try {
      const images = await db.enterpriseImage.findMany({
        where: { enterpriseId: id },
        select: { url: true },
      });
      if (images.length > 0) {
        const paths: string[] = [];
        for (const img of images) {
          try {
            const url = new URL(img.url);
            const storagePath = url.pathname.split('/enterprise-images/')[1];
            if (storagePath) paths.push(storagePath);
          } catch { /* skip malformed URLs */ }
        }
        if (paths.length > 0) {
          await supabaseServer.storage.from('enterprise-images').remove(paths);
        }
      }
    } catch (storageErr) {
      console.warn('[Enterprise DELETE] Erro ao limpar imagens do Storage:', storageErr);
      // Continue with DB deletion even if storage cleanup fails
    }

    // 2. Set enterpriseId to null on all linked clients and delete enterprise atomically
    await db.$transaction([
      db.client.updateMany({
        where: { enterpriseId: id },
        data: { enterpriseId: null },
      }),
      db.enterprise.delete({ where: { id } }),
    ]);

    return NextResponse.json({ message: 'Empreendimento excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir empreendimento:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
