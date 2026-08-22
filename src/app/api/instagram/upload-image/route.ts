import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import sharp from 'sharp'
import { supabaseServer } from '@/lib/supabase-server'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export async function POST(request: NextRequest) {
  try {
    const { error, session } = await requireAdmin()
    if (error) return error

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'Arquivo não enviado.' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'Tipo de arquivo inválido. Use JPEG, PNG, WebP ou AVIF.' },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Arquivo muito grande. Tamanho máximo: 10MB.' },
        { status: 400 }
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const processedBuffer = await sharp(Buffer.from(arrayBuffer))
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()

    const randomSuffix = Math.random().toString(36).slice(2, 8)
    const filePath = `posts/${session.user.id}/${Date.now()}-${randomSuffix}.webp`

    const { error: uploadError } = await supabaseServer.storage
      .from('instagram-posts')
      .upload(filePath, processedBuffer, { contentType: 'image/webp', upsert: false })

    if (uploadError) {
      if (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('bucket not found')) {
        return NextResponse.json(
          { error: 'Bucket instagram-posts não encontrado. Crie-o no Supabase Dashboard.', detail: 'bucket_missing' },
          { status: 500 }
        )
      }
      console.error('[INSTAGRAM POSTS] Erro ao fazer upload:', uploadError)
      return NextResponse.json({ error: 'Erro ao fazer upload da imagem.' }, { status: 500 })
    }

    const { data: urlData } = supabaseServer.storage
      .from('instagram-posts')
      .getPublicUrl(filePath)

    const publicUrl = urlData.publicUrl

    return NextResponse.json({ url: publicUrl, key: filePath })
  } catch (err) {
    console.error('[INSTAGRAM POSTS] Erro no upload de imagem:', err)
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 })
  }
}
