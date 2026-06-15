import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPortalToken } from '@/lib/portal-token';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('t');
    const clientId = searchParams.get('c');

    if (!token || !clientId) {
      return NextResponse.json(
        { error: 'Link inválido. Parâmetros ausentes.' },
        { status: 400 }
      );
    }

    const client = await db.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        region: true,
        enterprise: true,
        stage: true,
        createdAt: true,
        updatedAt: true,
        linkedEnterprise: { select: { name: true } },
      },
    });

    if (!client) {
      return NextResponse.json(
        { error: 'Cliente não encontrado.' },
        { status: 404 }
      );
    }

    // Verify token
    const isValid = verifyPortalToken(token, client.id, client.createdAt.toISOString());
    if (!isValid) {
      return NextResponse.json(
        { error: 'Link inválido ou expirado.' },
        { status: 403 }
      );
    }

    // Fetch schedules only — interactions are internal CRM notes, not for clients
    const schedules = await db.schedule.findMany({
      where: { clientId: client.id },
      orderBy: { scheduledDate: 'desc' },
      take: 30,
      select: {
        id: true,
        scheduledDate: true,
        scheduledTime: true,
        description: true,
        status: true,
        completedAt: true,
        createdAt: true,
        creatorUser: { select: { name: true } },
      },
    });

    const STAGE_LABELS: Record<string, string> = {
      LEAD: 'Lead',
      PROSPECT: 'Prospect',
      VISITA_AGENDADA: 'Visita Agendada',
      VISITA_REALIZADA: 'Visita Realizada',
      CARTA_PROPOSTA: 'Carta Proposta',
      CONTRATO_GERADO: 'Contrato Gerado',
      FECHADO_GANHO: 'Negócio Fechado',
      FECHADO_PERDIDO: 'Negócio Encerrado',
    };

    // Separate pending vs past schedules
    const now = new Date();
    const pendingSchedules = schedules.filter(
      (s) => s.status === 'PENDING' && new Date(s.scheduledDate) >= now
    );
    const pastSchedules = schedules.filter(
      (s) => s.status !== 'PENDING' || new Date(s.scheduledDate) < now
    );

    return NextResponse.json({
      client: {
        name: client.name,
        phone: client.phone,
        email: client.email,
        region: client.region,
        enterprise: client.enterprise || client.linkedEnterprise?.name || null,
        stage: STAGE_LABELS[client.stage] || client.stage,
        registeredSince: client.createdAt,
      },
      pendingSchedules: pendingSchedules.map((s) => ({
        id: s.id,
        date: s.scheduledDate,
        time: s.scheduledTime,
        description: s.description,
        createdBy: s.creatorUser?.name || 'Equipe',
      })),
      pastSchedules: pastSchedules.map((s) => ({
        id: s.id,
        date: s.scheduledDate,
        time: s.scheduledTime,
        description: s.description,
        status: s.status,
        completedAt: s.completedAt,
        createdBy: s.creatorUser?.name || 'Equipe',
      })),
    });
  } catch (error) {
    console.error('[PORTAL] Erro ao verificar acesso:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor.' },
      { status: 500 }
    );
  }
}