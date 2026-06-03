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
    const tagId = searchParams.get('tagId') || '';
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

    if (tagId) {
      baseWhere.tags = { some: { tagId } };
    }

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
    if (baseWhere.OR || baseWhere.region || baseWhere.tags) {
      if (!isAdminUser) {
        // Precisa combinar AND com OR
        const searchFilter = { ...baseWhere };
        where.AND = [accessFilter, searchFilter];
        delete where.OR;
        delete where.region;
        delete where.tags;
      }
    }

    if (needsUpdate) {
      const allWhere: Record<string, unknown> = { ...where };
      // Se AND existe, aplica no findMany
      const clientsNeedingUpdate = await db.client.findMany({
        where: allWhere,
        include: {
          tags: { include: { tag: true } },
          reminders: { orderBy: { dueDate: 'asc' }, take: 3 },
          linkedEnterprise: { select: { id: true, name: true, region: true, imageUrl: true } },
          partners: { include: { user: { select: { id: true, name: true, email: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const filtered = clientsNeedingUpdate.filter((client) => {
        const referenceDate = client.lastInteractionAt ? new Date(client.lastInteractionAt) : new Date(client.createdAt);
        const dueDate = new Date(referenceDate);
        dueDate.setDate(dueDate.getDate() + (client.updatePeriod || 30));
        return dueDate <= new Date();
      });

      const paginatedFiltered = filtered.slice((page - 1) * limit, page * limit);

      return NextResponse.json({ clients: paginatedFiltered, total: filtered.length, page, limit });
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
    return NextResponse.json({ 
      error: 'Failed to fetch clients',
      details: String(error),
    }, { status: 500 });
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
