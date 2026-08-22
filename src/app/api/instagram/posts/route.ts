import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { db } from '@/lib/db'
import { z } from 'zod'

const createPostSchema = z.object({
  caption: z.string().min(1, 'Legenda é obrigatória.').max(2200, 'Legenda muito longa. Máximo 2200 caracteres.'),
  imageUrl: z.string().url('URL da imagem inválida.'),
  imageKey: z.string().optional(),
  scheduledAt: z
    .string()
    .datetime()
    .optional()
    .transform(s => (s ? new Date(s) : null)),
})

export async function GET(request: NextRequest) {
  try {
    const { error, session } = await requireAdmin()
    if (error) return error

    const { searchParams } = request.nextUrl
    const status = searchParams.get('status') || undefined
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 20, 1), 50)
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

    const where: Record<string, unknown> = { createdBy: session.user.id }
    if (status) {
      ;(where as Record<string, string>).status = status
    }

    const [posts, total] = await Promise.all([
      db.instagramPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          status: true,
          caption: true,
          imageUrl: true,
          scheduledAt: true,
          publishedAt: true,
          igPermalink: true,
          errorMessage: true,
          retryCount: true,
          createdAt: true,
        },
      }),
      db.instagramPost.count({ where }),
    ])

    return NextResponse.json({ posts, total })
  } catch (err) {
    console.error('[INSTAGRAM POSTS] Erro ao listar posts:', err)
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { error, session } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const parsed = createPostSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { caption, imageUrl, imageKey, scheduledAt } = parsed.data

    if (scheduledAt) {
      const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000)
      if (scheduledAt < fiveMinutesFromNow) {
        return NextResponse.json(
          { error: 'Agendamento deve ser pelo menos 5 minutos no futuro.' },
          { status: 400 }
        )
      }
    }

    const status = scheduledAt ? 'SCHEDULED' : 'DRAFT'

    const post = await db.instagramPost.create({
      data: {
        caption,
        imageUrl,
        imageKey: imageKey ?? null,
        scheduledAt,
        status,
        createdBy: session.user.id,
        tokenUserId: session.user.id,
      },
    })

    return NextResponse.json(post, { status: 201 })
  } catch (err) {
    console.error('[INSTAGRAM POSTS] Erro ao criar post:', err)
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 })
  }
}
