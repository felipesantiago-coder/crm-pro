import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';
import crypto from 'crypto';

const resetSchema = z.object({
  token: z.string().min(1, 'Token é obrigatório'),
  newPassword: z
    .string()
    .min(8, 'A nova senha deve ter no mínimo 8 caracteres')
    .regex(/[A-Z]/, 'A nova senha deve conter pelo menos uma letra maiúscula')
    .regex(/[a-z]/, 'A nova senha deve conter pelo menos uma letra minúscula')
    .regex(/[0-9]/, 'A nova senha deve conter pelo menos um número'),
});

/**
 * Gera hash SHA-256 para o token de reset.
 * Mais rápido que bcrypt e suficiente para tokens descartáveis.
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 tentativas por minuto por IP
    const rateLimitResp = rateLimit(request, { maxRequests: 5, windowSeconds: 60, keyPrefix: 'reset-password' });
    if (rateLimitResp) return rateLimitResp;

    const body = await request.json();
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Dados inválidos';
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { token, newPassword } = parsed.data;

    // Hash do token recebido para comparação direta (O(1) ao invés de O(n) com bcrypt)
    const tokenHash = hashToken(token);

    const matchedUser = await db.user.findFirst({
      where: {
        passwordResetToken: tokenHash,
        passwordResetExpires: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!matchedUser) {
      return NextResponse.json(
        { error: 'Token inválido ou expirado. Solicite uma nova redefinição de senha.' },
        { status: 400 },
      );
    }

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
