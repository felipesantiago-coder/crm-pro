import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';

/**
 * DELETE /api/tracking/reset
 * Admin-only: deletes ALL tracking visitors and events.
 * Uses a transaction to ensure atomicity.
 * Events cascade-delete via Prisma relation onDelete: Cascade.
 */
export async function DELETE() {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const result = await db.$transaction(async (tx) => {
      const deletedVisitors = await tx.trackingVisitor.deleteMany();
      // Events are cascade-deleted, but delete explicitly for safety
      const deletedEvents = await tx.trackingEvent.deleteMany();
      return { visitors: deletedVisitors.count, events: deletedEvents.count };
    });

    return NextResponse.json({
      status: 'ok',
      deletedVisitors: result.visitors,
      deletedEvents: result.events,
    });
  } catch (err) {
    console.error('[Tracking Reset] Error:', err);
    return NextResponse.json(
      { error: 'Erro ao resetar dados de tracking' },
      { status: 500 },
    );
  }
}