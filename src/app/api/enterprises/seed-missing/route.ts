import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import enterprisesCatalog from '@/data/enterprises-catalog';

/**
 * POST /api/enterprises/seed-missing
 *
 * Creates DB records for all slugs defined in enterprises-catalog.ts
 * that don't yet exist in the database. Sets slug and region from catalog.
 * Idempotent — safe to call multiple times.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const existing = await db.enterprise.findMany({
      select: { slug: true, name: true },
    });
    const existingSlugs = new Set(
      existing.filter((e) => e.slug).map((e) => e.slug),
    );
    const existingNames = new Set(
      existing.map((e) => e.name.toLowerCase().trim()),
    );

    // Infer a human-readable name from the slug
    function slugToName(slug: string): string {
      return slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }

    const results: { slug: string; name: string; action: string }[] = [];

    for (const [slug, catalog] of Object.entries(enterprisesCatalog)) {
      // Skip if slug already taken
      if (existingSlugs.has(slug)) {
        results.push({ slug, name: '(existing)', action: 'skipped (slug exists)' });
        continue;
      }

      // Build a name: try catalog summary, fallback to slug-derived name
      const name = catalog.summary
        ? catalog.summary.split('—')[0].trim() || slugToName(slug)
        : slugToName(slug);

      // Avoid duplicate names
      if (existingNames.has(name.toLowerCase())) {
        results.push({ slug, name, action: 'skipped (name exists)' });
        continue;
      }

      await db.enterprise.create({
        data: {
          name,
          slug,
          region: catalog.location?.region || null,
        },
      });
      existingSlugs.add(slug);
      existingNames.add(name.toLowerCase());
      results.push({ slug, name, action: 'created' });
    }

    const created = results.filter((r) => r.action === 'created');
    return NextResponse.json({
      message: `${created.length} empreendimento(s) criado(s), ${results.length - created.length} ignorado(s).`,
      results,
    });
  } catch (error) {
    console.error('[Seed Missing] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}