import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { db } from '@/lib/db'
import { supabaseServer } from '@/lib/supabase-server'
import { publishImagePost } from '@/lib/instagram-api'
import { z } from 'zod'

const updatePostSchema = z.object({
  caption: z.string().min(1).max(2200).optional(),
  scheduledAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .transform(s => (s ? new Date(s) : null)),
  imageUrl: z.string().url().optional(),
})

// ──────────────────────────────────────────────
// PATCH — Update post
// ──────────────────────────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const existing = await db.instagramPost.findUnique({
      where: { id, createdBy: session.user.id },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Post não encontrado.' }, { status: 404 })
    }

    if (existing.status !== 'DRAFT' && existing.status !== 'SCHEDULED') {
      return NextResponse.json(
        { error: 'Apenas rascunhos e publicações agendadas podem ser editadas.' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const parsed = updatePostSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { caption, scheduledAt, imageUrl } = parsed.data

    if (scheduledAt) {
      const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000)
      if (scheduledAt < fiveMinutesFromNow) {
        return NextResponse.json(
          { error: 'Agendamento deve ser pelo menos 5 minutos no futuro.' },
          { status: 400 }
        )
      }
    }

    const updateData: Record<string, unknown> = {}
    if (caption !== undefined) updateData.caption = caption
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl

    // Determine status based on scheduledAt
    if (scheduledAt === null) {
      updateData.scheduledAt = null
      updateData.status = 'DRAFT'
    } else if (scheduledAt) {
      updateData.scheduledAt = scheduledAt
      updateData.status = 'SCHEDULED'
    }

    const updated = await db.instagramPost.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error('[INSTAGRAM POSTS] Erro ao atualizar post:', err)
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────
// DELETE — Delete post
// ──────────────────────────────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const post = await db.instagramPost.findUnique({
      where: { id, createdBy: session.user.id },
    })

    if (!post) {
      return NextResponse.json({ error: 'Post não encontrado.' }, { status: 404 })
    }

    if (post.status !== 'DRAFT' && post.status !== 'SCHEDULED') {
      return NextResponse.json(
        { error: 'Apenas rascunhos e publicações agendadas podem ser removidas.' },
        { status: 400 }
      )
    }

    if (post.imageKey) {
      await supabaseServer.storage
        .from('instagram-posts')
        .remove([post.imageKey])
    }

    await db.instagramPost.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[INSTAGRAM POSTS] Erro ao deletar post:', err)
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────
// POST — Publish now (action: 'publish-now')
// ──────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const body = await request.json()
    if (body.action !== 'publish-now') {
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
    }

    const post = await db.instagramPost.findFirst({
      where: { id, createdBy: session.user.id },
      include: { token: true },
    })

    if (!post) {
      return NextResponse.json({ error: 'Post não encontrado.' }, { status: 404 })
    }

    if (post.status !== 'DRAFT' && post.status !== 'SCHEDULED') {
      return NextResponse.json(
        { error: 'Apenas rascunhos e publicações agendadas podem ser publicadas.' },
        { status: 400 }
      )
    }

    const token = post.token
    if (!token) {
      return NextResponse.json(
        { error: 'Conta Instagram não conectada.' },
        { status: 400 }
      )
    }

    if (new Date(token.tokenExpiresAt) < new Date()) {
      return NextResponse.json(
        { error: 'Token expirado. Reconecte sua conta Instagram.' },
        { status: 400 }
      )
    }

    const previousStatus = post.status

    await db.instagramPost.update({
      where: { id },
      data: { status: 'PUBLISHING' },
    })

    try {
      const result = await publishImagePost(
        token.igUserId,
        post.imageUrl,
        post.caption,
        token.fbPageAccessToken
      )

      const updated = await db.instagramPost.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          igMediaId: result.mediaId,
          igPermalink: result.permalink,
          errorMessage: null,
        },
      })

      return NextResponse.json(updated)
    } catch (publishErr) {
      console.error('[INSTAGRAM POSTS] Erro ao publicar no Instagram:', publishErr)

      const updated = await db.instagramPost.update({
        where: { id },
        data: {
          status: previousStatus,
          errorMessage: publishErr instanceof Error ? publishErr.message : 'Erro desconhecido ao publicar.',
        },
      })

      return NextResponse.json(updated, { status: 500 })
    }
  } catch (err) {
    console.error('[INSTAGRAM POSTS] Erro no publish-now:', err);
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 })
  }
}
