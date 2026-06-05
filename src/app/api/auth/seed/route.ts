import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
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

    const passwordHash = await hashPassword('admincrmquadra@!');

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
