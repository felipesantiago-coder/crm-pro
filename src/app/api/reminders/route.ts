import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

async function getClientAccessFilter(userId: string, isAdmin: boolean) {
  return isAdmin
    ? {}
    : {
        OR: [
          { client: { createdBy: userId } },
          { client: { partners: { some: { userId } } } },
        ],
      };
}

async function canAccessClient(clientId: string, userId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const client = await db.client.findFirst({
    where: {
      id: clientId,
      OR: [
        { createdBy: userId },
        { partners: { some: { userId } } },
      ],
    },
    select: { id: true },
  });
  return !!client;
}

export async function GET(request: NextRequest) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId') || '';

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Buscar usuário para filtro de acesso
    const currentUser = await db.user.findUnique({
      where: { email: session!.user!.email! },
      select: { id: true, role: true },
    });
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const isAdmin = currentUser.role === 'ADMIN';
    const accessFilter = await getClientAccessFilter(currentUser.id, isAdmin);

    const where: Record<string, unknown> = { ...accessFilter };
    if (clientId) {
      where.clientId = clientId;
    }

    // Se não é admin e tem filtro de acesso, combinar com AND
    if (!isAdmin) {
      const andConditions: Record<string, unknown>[] = [accessFilter];
      if (clientId) {
        andConditions.push({ clientId });
      }
      (where as Record<string, unknown>).AND = andConditions;
      delete (where as Record<string, unknown>).clientId;
    }

    const [reminders, total] = await Promise.all([
      db.reminder.findMany({
        where,
        include: {
          client: {
            select: { id: true, name: true },
          },
        },
        orderBy: { dueDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.reminder.count({ where }),
    ]);

    return NextResponse.json({ reminders, total, page, limit });
  } catch (error) {
    console.error('Error fetching reminders:', error);
    return NextResponse.json({ error: 'Failed to fetch reminders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const body = await request.json();
    const { title, description, dueDate, clientId } = body;

    if (!title || title.trim() === '') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    if (!dueDate) {
      return NextResponse.json({ error: 'Due date is required' }, { status: 400 });
    }
    if (!clientId) {
      return NextResponse.json({ error: 'Client is required' }, { status: 400 });
    }

    // Buscar usuário para verificação de permissão
    const currentUser = await db.user.findUnique({
      where: { email: session!.user!.email! },
      select: { id: true, role: true },
    });
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    // Verificar acesso ao cliente associado
    const hasAccess = await canAccessClient(clientId, currentUser.id, currentUser.role === 'ADMIN');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso negado a este cliente' }, { status: 403 });
    }

    const clientExists = await db.client.findUnique({ where: { id: clientId } });
    if (!clientExists) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const reminder = await db.reminder.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        dueDate: new Date(dueDate),
        clientId,
      },
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json(reminder, { status: 201 });
  } catch (error) {
    console.error('Error creating reminder:', error);
    return NextResponse.json({ error: 'Failed to create reminder' }, { status: 500 });
  }
}