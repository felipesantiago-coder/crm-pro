import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { verifyPassword, hashPassword } from '@/lib/auth';
import { db } from '@/lib/db';
import { z } from 'zod';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Senha atual é obrigatória'),
  newPassword: z
    .string()
    .min(8, 'A nova senha deve ter no mínimo 8 caracteres')
    .regex(/[A-Z]/, 'A nova senha deve conter pelo menos uma letra maiúscula')
    .regex(/[a-z]/, 'A nova senha deve conter pelo menos uma letra minúscula')
    .regex(/[0-9]/, 'A nova senha deve conter pelo menos um número'),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Dados inválidos';
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { currentPassword, newPassword } = parsed.data;

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        passwordHash: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const isCurrentPasswordValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      return NextResponse.json(
        { error: 'Senha atual incorreta' },
        { status: 401 }
      );
    }

    const hashedNewPassword = await hashPassword(newPassword);

    await db.user.update({
      where: { id: session.user.id },
      data: {
        passwordHash: hashedNewPassword,
        mustChangePassword: false,
      },
      select: { id: true },
    });

    return NextResponse.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
