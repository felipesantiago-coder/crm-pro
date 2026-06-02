import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const region = searchParams.get('region') || '';
    const tagId = searchParams.get('tagId') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const needsUpdate = searchParams.get('needsUpdate') === 'true';

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { enterprise: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (region) {
      where.region = { contains: region, mode: 'insensitive' };
    }

    if (tagId) {
      where.tags = { some: { tagId } };
    }

    if (needsUpdate) {
      const now = new Date();
      const clientsNeedingUpdate = await db.client.findMany({
        include: {
          tags: { include: { tag: true } },
          reminders: { orderBy: { dueDate: 'asc' }, take: 3 },
          linkedEnterprise: { select: { id: true, name: true, region: true, imageUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const filtered = clientsNeedingUpdate.filter((client) => {
        const referenceDate = client.lastInteractionAt ? new Date(client.lastInteractionAt) : new Date(client.createdAt);
        const dueDate = new Date(referenceDate);
        dueDate.setDate(dueDate.getDate() + (client.updatePeriod || 30));
        return dueDate <= now;
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
    const body = await request.json();
    const { name, phone, email, region, enterprise, enterpriseId, notes, tagIds, updatePeriod } = body;

    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
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
        tags: tagIds?.length
          ? {
              create: tagIds.map((tagId: string) => ({ tagId })),
            }
          : undefined,
      },
      include: {
        tags: { include: { tag: true } },
        linkedEnterprise: { select: { id: true, name: true, region: true, imageUrl: true } },
      },
    });

    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    console.error('Error creating client:', error);
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 });
  }
}
