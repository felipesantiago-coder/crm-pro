import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { refreshLongLivedToken, publishImagePost } from '@/lib/instagram-api';

// ── In-flight lock (same pattern as fetch-meta-leads) ─────────────────
let isRunning = false;
export const maxDuration = 10;

// ── Auth: Bearer CRON_SECRET ───────────────────────────────────────────
function validateCronAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return authHeader === `Bearer ${secret}`;
}

// ── Token Refresh ─────────────────────────────────────────────────────
async function refreshExpiringTokens(): Promise<void> {
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const threshold = new Date(Date.now() + sevenDaysMs);

  const expiringTokens = await db.instagramToken.findMany({
    where: { tokenExpiresAt: { lte: threshold } },
  });

  for (const token of expiringTokens) {
    try {
      const result = await refreshLongLivedToken(token.fbPageAccessToken);
      const newExpiresAt = new Date(Date.now() + (result.expires_in * 1000));
      await db.instagramToken.update({
        where: { id: token.id },
        data: {
          fbPageAccessToken: result.access_token,
          tokenExpiresAt: newExpiresAt,
        },
      });
      console.log(`[INSTAGRAM CRON] Token renovado para userId=${token.userId}`);
    } catch (err) {
      console.error(`[INSTAGRAM CRON] Falha ao renovar token userId=${token.userId}:`, err);
    }
  }
}

// ── Main Handler ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!validateCronAuth(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  if (isRunning) {
    return NextResponse.json({ message: 'Já em execução' });
  }
  isRunning = true;

  const results = { processed: 0, published: 0, failed: 0 };

  try {
    await refreshExpiringTokens();

    const posts = await db.instagramPost.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: new Date() },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
      include: { token: true },
    });

    for (const post of posts) {
      results.processed++;

      await db.instagramPost.update({
        where: { id: post.id },
        data: { status: 'PUBLISHING' },
      });

      if (!post.token) {
        await db.instagramPost.update({
          where: { id: post.id },
          data: {
            status: 'FAILED',
            errorMessage: 'Conta Instagram não conectada para este usuário.',
          },
        });
        results.failed++;
        continue;
      }

      if (post.token.tokenExpiresAt < new Date()) {
        await db.instagramPost.update({
          where: { id: post.id },
          data: {
            status: 'FAILED',
            errorMessage: 'Token Instagram expirado. Reconecte a conta.',
          },
        });
        results.failed++;
        continue;
      }

      try {
        const { mediaId, permalink } = await publishImagePost(
          post.token.igUserId,
          post.imageUrl,
          post.caption,
          post.token.fbPageAccessToken,
        );

        await db.instagramPost.update({
          where: { id: post.id },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
            igMediaId: mediaId,
            igPermalink: permalink,
          },
        });
        results.published++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[INSTAGRAM CRON] Falha ao publicar post ${post.id}:`, msg);

        const newRetryCount = post.retryCount + 1;

        if (newRetryCount >= 3) {
          await db.instagramPost.update({
            where: { id: post.id },
            data: {
              status: 'FAILED',
              errorMessage: msg.slice(0, 500),
              retryCount: newRetryCount,
            },
          });
        } else {
          await db.instagramPost.update({
            where: { id: post.id },
            data: {
              status: 'SCHEDULED',
              errorMessage: msg.slice(0, 500),
              retryCount: newRetryCount,
            },
          });
        }
        results.failed++;
      }
    }

    console.log(`[INSTAGRAM CRON] Processados: ${results.processed} | Publicados: ${results.published} | Falhas: ${results.failed}`);
    return NextResponse.json(results);
  } catch (err) {
    console.error('[INSTAGRAM CRON] Erro geral:', err);
    return NextResponse.json({ error: 'Erro interno do cron' }, { status: 500 });
  } finally {
    isRunning = false;
  }
}
