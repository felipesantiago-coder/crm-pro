import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, hashPassword } from '@/lib/auth';

/**
 * Endpoint de diagnóstico para testar o fluxo de login passo a passo.
 * GET  - Informações gerais (sem senha)
 * POST - Teste completo com email/senha
 *
 * SEGURANÇA: Remover este endpoint após resolver o problema de login!
 */
export async function GET() {
  try {
    const user = await db.user.findFirst({
      where: { email: 'felipesantiagoquadra@gmail.com' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mustChangePassword: true,
        passwordHash: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({
        step: 'db_lookup',
        status: 'error',
        message: 'Usuário admin não encontrado no banco de dados',
      });
    }

    const hashInfo = {
      hasHash: !!user.passwordHash,
      hashLength: user.passwordHash?.length || 0,
      hashPrefix: user.passwordHash?.substring(0, 10) || 'N/A',
    };

    return NextResponse.json({
      step: 'db_lookup',
      status: 'ok',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      passwordHash: hashInfo,
      env: {
        nextauthSecret: !!process.env.NEXTAUTH_SECRET,
        nextauthSecretLength: process.env.NEXTAUTH_SECRET?.length || 0,
        databaseUrl: !!process.env.DATABASE_URL,
        nodeEnv: process.env.NODE_ENV,
      },
      warning: 'Remover este endpoint após resolver o problema!',
    });
  } catch (error) {
    return NextResponse.json({
      step: 'db_lookup',
      status: 'error',
      message: 'Erro ao buscar usuário',
      error: String(error),
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const timing: Record<string, number> = {};

  try {
    // Passo 1: Extrair body da request
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      try {
        const text = await request.text();
        body = Object.fromEntries(new URLSearchParams(text));
      } catch {
        body = null;
      }
    }
    timing['body_parse'] = Date.now() - startTime;

    if (!body || typeof body !== 'object') {
      return NextResponse.json({
        step: 'body_parse',
        status: 'error',
        message: 'Não foi possível extrair o corpo da requisição',
        timing,
      }, { status: 400 });
    }

    const { email, password, action } = body as Record<string, string>;

    // Ação de reset de senha
    if (action === 'reset-password' && email) {
      const resetStart = Date.now();
      const user = await db.user.findUnique({ where: { email } });
      timing['db_lookup'] = Date.now() - resetStart;

      if (!user) {
        return NextResponse.json({
          step: 'reset',
          status: 'error',
          message: 'Usuário não encontrado',
          timing,
        }, { status: 404 });
      }

      const hashStart = Date.now();
      const newHash = await hashPassword('admincrmquadra@!');
      timing['hash'] = Date.now() - hashStart;

      await db.user.update({
        where: { email },
        data: {
          passwordHash: newHash,
          mustChangePassword: false,
        },
      });

      return NextResponse.json({
        step: 'reset',
        status: 'ok',
        message: 'Senha resetada para: admincrmquadra@!',
        user: { id: user.id, name: user.name, email: user.email },
        timing,
        warning: 'ALTERE A SENHA IMEDIATAMENTE APÓS LOGAR!',
      });
    }

    // Passo 2: Verificar credenciais recebidas
    if (!email || !password) {
      return NextResponse.json({
        step: 'credentials_check',
        status: 'error',
        message: 'Email ou senha não fornecidos',
        received: { email: !!email, password: !!password, emailValue: email || 'missing', bodyKeys: Object.keys(body as object) },
        timing,
      }, { status: 400 });
    }
    timing['credentials_check'] = Date.now() - startTime;

    // Passo 3: Buscar usuário no banco
    const dbStart = Date.now();
    const trimmedEmail = email.trim().toLowerCase();
    const user = await db.user.findUnique({
      where: { email: trimmedEmail },
    });
    timing['db_lookup'] = Date.now() - dbStart;

    if (!user) {
      return NextResponse.json({
        step: 'db_lookup',
        status: 'error',
        message: 'Usuário não encontrado no banco de dados',
        searchedEmail: trimmedEmail,
        timing,
      });
    }
    timing['user_found'] = Date.now() - startTime;

    // Passo 4: Verificar hash
    if (!user.passwordHash) {
      return NextResponse.json({
        step: 'hash_check',
        status: 'error',
        message: 'Campo passwordHash está vazio/null no banco de dados',
        user: { id: user.id, email: user.email, hasPasswordHash: false },
        timing,
      });
    }

    // Passo 5: Verificar senha com bcrypt
    const bcryptStart = Date.now();
    const isValid = await verifyPassword(password, user.passwordHash);
    timing['bcrypt_verify'] = Date.now() - bcryptStart;

    if (!isValid) {
      return NextResponse.json({
        step: 'password_verify',
        status: 'error',
        message: 'Senha incorreta! A senha fornecida não corresponde ao hash armazenado.',
        user: { id: user.id, email: user.email, role: user.role },
        passwordTest: {
          providedPasswordLength: password.length,
          hashLength: user.passwordHash.length,
          hashPrefix: user.passwordHash.substring(0, 15),
          isValid,
        },
        hint: 'Se você esqueceu a senha, use action=reset-password no body desta requisição.',
        timing,
      });
    }

    // Passo 6: Sucesso!
    return NextResponse.json({
      step: 'login_success',
      status: 'ok',
      message: 'Login válido! Todas as verificações passaram.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      timing,
    });
  } catch (error) {
    return NextResponse.json({
      step: 'unexpected_error',
      status: 'error',
      message: 'Erro inesperado durante o teste',
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack?.substring(0, 500),
      } : String(error),
      timing,
    }, { status: 500 });
  }
}
