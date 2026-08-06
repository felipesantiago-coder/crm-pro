import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

/**
 * List client error logs — ADMIN only.
 * Supports ?resolved=true|false, ?slug=xxx, ?type=js_error, ?limit=N, ?cursor=xxx
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userRole = (session?.user as { role?: string })?.role;
  if (userRole !== 'ADMIN') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const resolved = searchParams.get('resolved');
  const slug = searchParams.get('slug');
  const type = searchParams.get('type');
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);
  const cursor = searchParams.get('cursor');

  const where: Record<string, unknown> = {};
  if (resolved === 'true') where.resolved = true;
  else if (resolved === 'false') where.resolved = false;
  if (slug) where.slug = slug;
  if (type) where.type = type;

  const [errors, stats] = await Promise.all([
    db.clientErrorLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor
        ? { cursor: { id: cursor }, skip: 1 }
        : {}),
    }),
    db.clientErrorLog.groupBy({
      by: ['type'],
      _count: true,
      where: { resolved: false },
    }),
  ]);

  const hasMore = errors.length > limit;
  const items = hasMore ? errors.slice(0, limit) : errors;

  const unresolvedCount = await db.clientErrorLog.count({
    where: { resolved: false },
  });

  return NextResponse.json({
    errors: items,
    hasMore,
    nextCursor: hasMore ? items[items.length - 1].id : null,
    stats: stats.map((s) => ({ type: s.type, count: s._count })),
    unresolvedCount,
  });
}
