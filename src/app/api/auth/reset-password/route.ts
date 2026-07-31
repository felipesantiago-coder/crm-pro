import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { z } from 'zod';

const resetSchema = z.object({
  token: z.string().min(1, 'Token é obrigatório'),
  newPassword: z
    .string()
    .min(8, 'A nova senha deve ter no mínimo 8 caracteres')
    .regex(/[A-Z]/, 'A nova senha deve conter pelo menos uma letra maiúscula')
    .regex(/[a-z]/, 'A nova senha deve conter pelo menos uma letra minúscula')
    .regex(/[0-9]/, 'A nova senha deve conter pelo menos um número'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Dados inválidos';
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { token, newPassword } = parsed.data;

    // Busca qualquer usuário com token de reset não expirado
    const usersWithToken = await db.user.findMany({
      where: {
        passwordResetToken: { not: null },
        passwordResetExpires: { gt: new Date() },
      },
      select: {
        id: true,
        passwordResetToken: true,
        passwordResetExpires: true,
      },
    });

    // Verifica qual usuário corresponde ao token (comparando hash)
    let matchedUser: (typeof usersWithToken)[0] | null = null;
    for (const user of usersWithToken) {
      const isValid = await verifyPassword(token, user.passwordResetToken!);
      if (isValid) {
        matchedUser = user;
        break;
      }
    }

    if (!matchedUser) {
      return NextResponse.json(
        { error: 'Token inválido ou expirado. Solicite uma nova redefinição de senha.' },
        { status: 400 },
      );
    }

    // Atualiza a senha e limpa o token
    const hashedNewPassword = await hashPassword(newPassword);

    await db.user.update({
      where: { id: matchedUser.id },
      data: {
        passwordHash: hashedNewPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        mustChangePassword: false,
      },
    });

    return NextResponse.json({ message: 'Senha redefinida com sucesso!' });
  } catch (error) {
    console.error('[RESET-PASSWORD] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 },
    );
  }
}
