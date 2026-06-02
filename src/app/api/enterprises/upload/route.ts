import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const enterpriseId = formData.get('enterpriseId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    if (!enterpriseId) {
      return NextResponse.json({ error: 'ID do empreendimento é obrigatório' }, { status: 400 });
    }

    // Validate file type
    if (!file.type.includes('webp') && !file.type.includes('image')) {
      return NextResponse.json({ error: 'Apenas imagens WebP são aceitas' }, { status: 400 });
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Imagem muito grande. Máximo 5MB.' }, { status: 400 });
    }

    // Check enterprise exists
    const enterprise = await db.enterprise.findUnique({ where: { id: enterpriseId } });
    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    // Create uploads directory if it doesn't exist
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'enterprises');
    await mkdir(uploadDir, { recursive: true });

    // Generate unique filename
    const fileExtension = 'webp';
    const fileName = `${enterpriseId}-${Date.now()}.${fileExtension}`;
    const filePath = path.join(uploadDir, fileName);

    // Write file
    const bytes = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));

    // Update enterprise imageUrl
    const imageUrl = `/uploads/enterprises/${fileName}`;
    await db.enterprise.update({
      where: { id: enterpriseId },
      data: { imageUrl },
    });

    return NextResponse.json({ imageUrl, message: 'Imagem enviada com sucesso' });
  } catch (error) {
    console.error('Erro ao enviar imagem:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
