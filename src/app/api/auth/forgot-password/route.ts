import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';
import crypto from 'crypto';

const forgotSchema = z.object({
  email: z.string().email('Email inválido'),
});

const TOKEN_EXPIRY_MINUTES = 30;

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 3 solicitações por minuto por IP
    const rateLimitResp = rateLimit(request, { maxRequests: 3, windowSeconds: 60, keyPrefix: 'forgot-password' });
    if (rateLimitResp) return rateLimitResp;

    const body = await request.json();
    const parsed = forgotSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Dados inválidos';
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { email } = parsed.data;

    // Sempre retorna sucesso para evitar enumeração de emails
    // mas só envia email se o usuário existe
    const user = await db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, name: true, email: true },
    });

    if (user) {
      // Gera token aleatório e armazena o hash (SHA-256 para busca O(1))
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

      await db.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: expiresAt,
        },
      });

      const resetUrl = `${appUrl()}/reset-password?token=${rawToken}`;

      const htmlBody = `
        <p style="margin:0 0 8px; font-size:15px; color:#1e293b;">Olá, <strong>${user.name}</strong>!</p>
        <p style="margin:0 0 20px; font-size:15px; color:#1e293b;">Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo para criar uma nova senha. Este link expira em <strong>${TOKEN_EXPIRY_MINUTES} minutos</strong>.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
          <tr>
            <td align="center">
              <a href="${resetUrl}" style="display:inline-block; background:linear-gradient(135deg,#10b981,#0d9488); color:#ffffff; text-decoration:none; padding:12px 32px; border-radius:8px; font-weight:600; font-size:14px;">Redefinir minha senha</a>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 8px; font-size:13px; color:#64748b;">Se o botão não funcionar, copie e cole este link no seu navegador:</p>
        <p style="margin:0 0 20px; font-size:13px; color:#0d9488; word-break:break-all;">${resetUrl}</p>
        <p style="margin:0; font-size:13px; color:#94a3b8;">Se você não solicitou a redefinição, ignore este email. Sua senha permanecerá inalterada.</p>
      `;

      await sendEmail({
        to: user.email,
        subject: 'Redefinição de senha - CRM Pro',
        htmlBody,
      });
    }

    return NextResponse.json({
      message: 'Se o email estiver cadastrado, você receberá as instruções para redefinir sua senha.',
    });
  } catch (error) {
    console.error('[FORGOT-PASSWORD] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 },
    );
  }
}
