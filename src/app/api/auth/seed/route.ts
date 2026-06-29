import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

// Endpoint de seed protegido — requer header secreto para ser executado
export async function POST(request: NextRequest) {
  try {
    // Verificar segredo de seed
    const seedSecret = process.env.SEED_SECRET;
    if (!seedSecret) {
      return NextResponse.json({ error: 'Seed desabilitado' }, { status: 403 });
    }

    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${seedSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const existingAdmin = await db.user.findUnique({
      where: { email: 'felipesantiagoquadra@gmail.com' },
      select: { id: true, name: true, email: true, role: true },
    });

    if (existingAdmin) {
      return NextResponse.json({
        message: 'Administrador padrão já existe',
        user: {
          id: existingAdmin.id,
          name: existingAdmin.name,
          email: existingAdmin.email,
          role: existingAdmin.role,
        },
      });
    }

    const SEED_PASSWORD = process.env.SEED_PASSWORD;
    if (!SEED_PASSWORD) {
      return NextResponse.json(
        { error: 'SEED_PASSWORD não configurada' },
        { status: 500 }
      );
    }
    const passwordHash = await hashPassword(SEED_PASSWORD);

    const admin = await db.user.create({
      data: {
        name: 'Administrador',
        email: 'felipesantiagoquadra@gmail.com',
        passwordHash,
        role: 'ADMIN',
        mustChangePassword: true,
      },
      select: { id: true, name: true, email: true, role: true },
    });

    return NextResponse.json({
      message: 'Administrador padrão criado com sucesso',
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error('Erro ao criar administrador padrão:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}