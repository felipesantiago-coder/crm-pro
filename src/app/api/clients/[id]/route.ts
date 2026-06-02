import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = await db.client.findUnique({
      where: { id },
      include: {
        tags: { include: { tag: true } },
        reminders: { orderBy: { dueDate: 'asc' } },
        interactions: { orderBy: { createdAt: 'desc' } },
        linkedEnterprise: { select: { id: true, name: true, region: true, imageUrl: true } },
      },
    });

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    return NextResponse.json(client);
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
    const { id } = await params;
    const body = await request.json();
    const { name, phone, email, region, enterprise, enterpriseId, notes, tagIds, updatePeriod } = body;

    const existingClient = await db.client.findUnique({ where: { id } });
    if (!existingClient) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
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
    const { id } = await params;
    const existingClient = await db.client.findUnique({ where: { id } });
    if (!existingClient) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
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
    const { id } = await params;
    await db.client.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting client:', error);
    return NextResponse.json({ error: 'Failed to delete client' }, { status: 500 });
  }
}
