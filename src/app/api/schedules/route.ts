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

    const currentUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });

    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';
    const limit = parseInt(searchParams.get('limit') || '20');

    const isAdminUser = currentUser.role === 'ADMIN';

    // Build access filter: ADMIN sees all, USER sees own + partner schedules
    const accessFilter: Record<string, unknown> = isAdminUser
      ? {}
      : {
          OR: [
            { client: { createdBy: currentUser.id } },
            { client: { partners: { some: { userId: currentUser.id } } } },
          ],
        };

    const where: Record<string, unknown> = { ...accessFilter };

    if (status) {
      where.status = status;
    }

    const schedules = await db.schedule.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, phone: true } },
        creatorUser: { select: { id: true, name: true } },
      },
      orderBy: { scheduledDate: 'asc' },
      take: limit,
    });

    return NextResponse.json({ schedules });
  } catch (error) {
    console.error('Error fetching schedules:', error);
    return NextResponse.json({ error: 'Failed to fetch schedules' }, { status: 500 });
  }
}
