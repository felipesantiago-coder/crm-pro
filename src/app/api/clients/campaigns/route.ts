import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

/**
 * Returns distinct utmCampaign values from clients for the filter dropdown.
 */
export async function GET() {
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

    const isAdminUser = currentUser.role === 'ADMIN';

    // Build access filter
    const accessClause = isAdminUser
      ? ''
      : `AND (c."created_by" = '${currentUser.id}' OR EXISTS (
           SELECT 1 FROM client_partners cp WHERE cp."client_id" = c.id AND cp."user_id" = '${currentUser.id}'
         ))`;

    const campaigns = await db.$queryRaw<Array<{ utmCampaign: string; count: bigint }>>`
      SELECT c."utmCampaign", COUNT(*)::bigint as count
      FROM "clients" c
      WHERE c."utmCampaign" IS NOT NULL AND c."utmCampaign" != ''
      ${accessClause}
      GROUP BY c."utmCampaign"
      ORDER BY count DESC
    `;

    return NextResponse.json(campaigns.map(c => ({
      name: c.utmCampaign,
      count: Number(c.count),
    })));
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 });
  }
}