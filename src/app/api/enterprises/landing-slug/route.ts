import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { invalidatePublicSnapshotsForEnterprise } from '@/lib/public-snapshot';

export async function PUT(request: NextRequest) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const body = await request.json();
    const { id, slug } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID do empreendimento é obrigatório' }, { status: 400 });
    }

    // If slug is empty, deactivate landing page
    if (!slug || !slug.trim()) {
      await db.enterprise.update({
        where: { id },
        data: { slug: null },
      });
      // Fase 7: slug é a CHAVE de leitura do snapshot — landing
      // desativada/renomeada mata os snapshots do empreendimento (o
      // snapshot do slug antigo ficaria órfão até o TTL).
      await invalidatePublicSnapshotsForEnterprise(db, id);
      return NextResponse.json({ success: true, slug: null });
    }

    const trimmedSlug = slug.trim().toLowerCase();

    // Validate slug format
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(trimmedSlug)) {
      return NextResponse.json(
        { error: 'Slug inválido. Use apenas letras minúsculas, números e hífens.' },
        { status: 400 }
      );
    }

    // Check uniqueness
    const existing = await db.enterprise.findFirst({
      where: { slug: trimmedSlug, NOT: { id } },
      select: { id: true, name: true },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Já existe um empreendimento com este slug ("${existing.name}")` },
        { status: 409 }
      );
    }

    const enterprise = await db.enterprise.update({
      where: { id },
      data: { slug: trimmedSlug },
      select: { id: true, name: true, slug: true },
    });

    // Fase 7: slug trocado — snapshots do slug antigo ficariam órfãos
    // (a chave de leitura mudou); o novo slug recompõe no primeiro acesso.
    await invalidatePublicSnapshotsForEnterprise(db, id);

    return NextResponse.json(enterprise);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'Já existe um empreendimento com este slug.' }, { status: 409 });
    }
    console.error('[Landing Slug] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}