import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const { id } = await params;

    // Verify the user has access to this client
    const currentUser = await db.user.findUnique({
      where: { email: session!.user.email },
      select: { id: true, role: true },
    });
    if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

    const client = await db.client.findUnique({
      where: { id },
      include: {
        tags: { include: { tag: true } },
        reminders: { orderBy: { dueDate: 'asc' } },
        linkedEnterprise: { select: { id: true, name: true, region: true, imageUrl: true } },
        creator: { select: { id: true, name: true, email: true } },
        partners: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            addedByUser: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Check ownership/partner access (ADMIN can see all)
    if (currentUser.role !== 'ADMIN') {
      const isCreator = client.createdBy === currentUser.id;
      const isPartner = client.partners?.some((p) => p.userId === currentUser.id);
      if (!isCreator && !isPartner) {
        return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
      }
    }

    // Buscar interações separadamente com fallback se tabela não existir
    let interactions: Record<string, unknown>[] = [];
    try {
      interactions = await db.interaction.findMany({
        where: { clientId: id },
        orderBy: { createdAt: 'desc' },
      });
    } catch {
      // Tabela interactions ainda não existe no banco — retorna array vazio
    }

    // Buscar agendamentos separadamente com fallback se tabela não existir
    let schedules: Record<string, unknown>[] = [];
    try {
      schedules = await db.schedule.findMany({
        where: { clientId: id },
        orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }],
        include: {
          creatorUser: { select: { id: true, name: true } },
        },
      });
      // Map creatorUser to creator for the frontend
      schedules = schedules.map((s: Record<string, unknown>) => ({
        ...s,
        creator: s.creatorUser,
        creatorUser: undefined,
      }));
    } catch {
      // Tabela schedules ainda não existe no banco — retorna array vazio
    }

    return NextResponse.json({ ...client, interactions, schedules });
  } catch (error) {
    console.error('Error fetching client:', error);
    return NextResponse.json({ error: 'Failed to fetch client' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const { id } = await params;

    // Verify the user has access to this client
    const currentUser = await db.user.findUnique({
      where: { email: session!.user.email },
      select: { id: true, role: true },
    });
    if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

    const body = await request.json();
    const { name, phone, email, region, enterprise, enterpriseId, notes, tagIds, updatePeriod } = body;

    const existingClient = await db.client.findUnique({ where: { id }, include: { partners: true } });
    if (!existingClient) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Check ownership/partner access (ADMIN can edit all)
    if (currentUser.role !== 'ADMIN') {
      const isCreator = existingClient.createdBy === currentUser.id;
      const isPartner = existingClient.partners?.some((p: { userId: string }) => p.userId === currentUser.id);
      if (!isCreator && !isPartner) {
        return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
      }
    }

    if (tagIds !== undefined) {
      await db.clientTag.deleteMany({ where: { clientId: id } });
    }

    const client = await db.client.update({
      where: { id },
      data: {
        name: name?.trim() || existingClient.name,
        phone: phone?.trim() !== undefined ? (phone.trim() || null) : existingClient.phone,
        email: email?.trim() !== undefined ? (email.trim() || null) : existingClient.email,
        region: region?.trim() !== undefined ? (region.trim() || null) : existingClient.region,
        enterprise: enterprise?.trim() !== undefined ? (enterprise.trim() || null) : existingClient.enterprise,
        enterpriseId: enterpriseId !== undefined ? (enterpriseId || null) : existingClient.enterpriseId,
        notes: notes?.trim() !== undefined ? (notes.trim() || null) : existingClient.notes,
        ...(updatePeriod !== undefined ? { updatePeriod } : {}),
        ...(tagIds !== undefined && tagIds?.length
          ? {
              tags: {
                create: tagIds.map((tagId: string) => ({ tagId })),
              },
            }
          : {}),
      },
      include: {
        tags: { include: { tag: true } },
        linkedEnterprise: { select: { id: true, name: true, region: true, imageUrl: true } },
      },
    });

    return NextResponse.json(client);
  } catch (error) {
    console.error('Error updating client:', error);
    return NextResponse.json({ error: 'Failed to update client' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const { id } = await params;

    // Verify the user has access to this client
    const currentUser = await db.user.findUnique({
      where: { email: session!.user.email },
      select: { id: true, role: true },
    });
    if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

    const existingClient = await db.client.findUnique({ where: { id }, include: { partners: true } });
    if (!existingClient) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Check ownership/partner access (ADMIN can edit all)
    if (currentUser.role !== 'ADMIN') {
      const isCreator = existingClient.createdBy === currentUser.id;
      const isPartner = existingClient.partners?.some((p: { userId: string }) => p.userId === currentUser.id);
      if (!isCreator && !isPartner) {
        return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
      }
    }

    const client = await db.client.update({
      where: { id },
      data: {
        lastInteractionAt: new Date(),
      },
    });

    return NextResponse.json(client);
  } catch (error) {
    console.error('Error recording interaction:', error);
    return NextResponse.json({ error: 'Failed to record interaction' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const { id } = await params;

    // Verify the user has access to this client
    const currentUser = await db.user.findUnique({
      where: { email: session!.user.email },
      select: { id: true, role: true },
    });
    if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

    const existingClient = await db.client.findUnique({ where: { id } });
    if (!existingClient) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Only creator or ADMIN can delete
    if (currentUser.role !== 'ADMIN' && existingClient.createdBy !== currentUser.id) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    await db.client.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting client:', error);
    return NextResponse.json({ error: 'Failed to delete client' }, { status: 500 });
  }
}
