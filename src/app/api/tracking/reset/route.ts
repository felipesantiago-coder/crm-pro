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

    const [deletedVisitors, deletedEvents] = await db.$transaction([
      db.trackingVisitor.deleteMany(),
      // Events are cascade-deleted, but delete explicitly for safety
      db.trackingEvent.deleteMany(),
    ]);

    return NextResponse.json({
      status: 'ok',
      deletedVisitors: deletedVisitors.count,
      deletedEvents: deletedEvents.count,
    });
  } catch (err) {
    console.error('[Tracking Reset] Error:', err);
    return NextResponse.json(
      { error: 'Erro ao resetar dados de tracking' },
      { status: 500 },
    );
  }
}