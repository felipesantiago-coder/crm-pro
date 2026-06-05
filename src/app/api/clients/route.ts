import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Buscar usuário atual para filtrar clientes
    const currentUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });

    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const region = searchParams.get('region') || '';
    const tagIds = searchParams.getAll('tagId').filter(Boolean);
    const stage = searchParams.get('stage') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const needsUpdate = searchParams.get('needsUpdate') === 'true';

    // ADMIN vê todos; USER vê apenas os que criou + os que é parceiro
    const isAdminUser = currentUser.role === 'ADMIN';

    const baseWhere: Record<string, unknown> = {};

    if (search) {
      baseWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { enterprise: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (region) {
      baseWhere.region = { contains: region, mode: 'insensitive' };
    }

    if (tagIds.length > 0) {
      baseWhere.tags = { every: tagIds.map((id) => ({ tagId: id })) };
    }

    if (stage) {
      const stages = stage.split(',').map((s) => s.trim()).filter(Boolean);
      if (stages.length === 1) {
        baseWhere.stage = stages[0];
      } else if (stages.length > 1) {
        baseWhere.stage = { in: stages };
      }
    }

    const excludeClosed = searchParams.get('excludeClosed') === 'true';

    // Montar filtro de acesso por usuário
    let accessFilter: Record<string, unknown> = {};
    if (!isAdminUser) {
      accessFilter = {
        OR: [
          { createdBy: currentUser.id },
          { partners: { some: { userId: currentUser.id } } },
        ],
      };
    }

    const where: Record<string, unknown> = {
      ...baseWhere,
      ...accessFilter,
    };

    // Se há filtros de busca/região/tag, combinar com o filtro de acesso
    if (baseWhere.OR || baseWhere.region || baseWhere.tags || baseWhere.stage || (baseWhere.AND && baseWhere.AND.length > 0)) {
      if (!isAdminUser) {
        // Precisa combinar AND com OR
        const searchFilter = { ...baseWhere };
        where.AND = [accessFilter, searchFilter];
        delete where.OR;
        delete where.region;
        delete where.tags;
        delete where.stage;
      }
    }

    // Excluir negócios finalizados da listagem principal
    if (excludeClosed && !stage) {
      where.stage = { notIn: ['FECHADO_GANHO', 'FECHADO_PERDIDO'] };
    }

    if (needsUpdate) {
      const now = new Date();
      const clientsNeedingUpdate = await db.$queryRaw`
        SELECT c.* FROM "clients" c
        WHERE 
          CASE 
            WHEN c."lastInteractionAt" IS NOT NULL 
            THEN (c."lastInteractionAt" + (c."updatePeriod" || ' days')::interval) <= ${now}
            ELSE (c."createdAt" + (c."updatePeriod" || ' days')::interval) <= ${now}
          END
        ORDER BY c."createdAt" DESC
      `;

      const paginatedIds = (clientsNeedingUpdate as Array<{id: string}>)
        .slice((page - 1) * limit, page * limit)
        .map(c => c.id);

      if (paginatedIds.length === 0) {
        return NextResponse.json({ clients: [], total: 0, page, limit });
      }

      const clients = await db.client.findMany({
        where: { id: { in: paginatedIds } },
        include: {
          tags: { include: { tag: true } },
          reminders: { orderBy: { dueDate: 'asc' }, take: 3 },
          linkedEnterprise: { select: { id: true, name: true, region: true, imageUrl: true } },
          partners: { include: { user: { select: { id: true, name: true, email: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return NextResponse.json({ clients, total: (clientsNeedingUpdate as Array<unknown>).length, page, limit });
    }

    const [clients, total] = await Promise.all([
      db.client.findMany({
        where,
        include: {
          tags: { include: { tag: true } },
          reminders: { orderBy: { dueDate: 'asc' }, take: 3 },
          linkedEnterprise: { select: { id: true, name: true, region: true, imageUrl: true } },
          partners: { include: { user: { select: { id: true, name: true, email: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.client.count({ where }),
    ]);

    return NextResponse.json({ clients, total, page, limit });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const { name, phone, email, region, enterprise, enterpriseId, notes, tagIds, updatePeriod, partnerIds } = body;

    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Buscar o usuário atual para definir como criador
    const currentUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const client = await db.client.create({
      data: {
        name: name.trim(),
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        region: region?.trim() || null,
        enterprise: enterprise?.trim() || null,
        enterpriseId: enterpriseId || null,
        notes: notes?.trim() || null,
        updatePeriod: updatePeriod || 30,
        createdBy: currentUser.id,
        tags: tagIds?.length
          ? {
              create: tagIds.map((tagId: string) => ({ tagId })),
            }
          : undefined,
        partners: partnerIds?.length
          ? {
              create: partnerIds.map((userId: string) => ({
                userId,
                addedBy: currentUser.id,
              })),
            }
          : undefined,
      },
      include: {
        tags: { include: { tag: true } },
        linkedEnterprise: { select: { id: true, name: true, region: true, imageUrl: true } },
        partners: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });

    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    console.error('Error creating client:', error);
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 });
  }
}
