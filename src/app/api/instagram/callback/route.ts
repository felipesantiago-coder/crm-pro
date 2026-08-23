import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getUserFacebookPages,
  getInstagramBusinessAccount,
} from '@/lib/instagram-api';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';

/** Helper: cria redirect com cookie deletado */
function redirectWithClearedCookie(url: string) {
  const res = NextResponse.redirect(url);
  res.cookies.delete('ig_oauth_state');
  return res;
}

// GET /api/instagram/callback — Recebe o callback OAuth do Instagram
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    // Verificar parâmetros obrigatórios
    if (!code || !state) {
      console.error('[INSTAGRAM CALLBACK] Parâmetros ausentes:', { code: !!code, state: !!state });
      return redirectWithClearedCookie(`${APP_URL}/?instagram=error&msg=parametros_invalidos`);
    }

    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error('[INSTAGRAM CALLBACK] CRON_SECRET não configurado');
      return redirectWithClearedCookie(`${APP_URL}/?instagram=error&msg=parametros_invalidos`);
    }

    // Validar state: formato esperado = randomHex.hmacHex.userId
    const stateParts = state.split('.');
    if (stateParts.length !== 3) {
      console.error('[INSTAGRAM CALLBACK] Formato de state inválido');
      return redirectWithClearedCookie(`${APP_URL}/?instagram=error&msg=parametros_invalidos`);
    }

    const [randomHex, hmacHex, userId] = stateParts;

    // Verificar HMAC
    const expectedHmac = crypto
      .createHmac('sha256', cronSecret)
      .update(randomHex)
      .digest('hex');

    if (hmacHex !== expectedHmac) {
      console.error('[INSTAGRAM CALLBACK] HMAC inválido — possível ataque CSRF');
      return redirectWithClearedCookie(`${APP_URL}/?instagram=error&msg=parametros_invalidos`);
    }

    // Verificar cookie
    const cookieState = request.cookies.get('ig_oauth_state')?.value;
    if (cookieState !== randomHex) {
      console.error('[INSTAGRAM CALLBACK] Cookie de state não corresponde');
      return redirectWithClearedCookie(`${APP_URL}/?instagram=error&msg=parametros_invalidos`);
    }

    const callbackUrl = `${APP_URL}/api/instagram/callback`;

    // Trocar código por token de curta duração
    const shortLivedTokenData = await exchangeCodeForToken(code, callbackUrl);
    const shortLivedToken = shortLivedTokenData.access_token;

    // Trocar por token de longa duração (~60 dias)
    const longLivedTokenData = await exchangeForLongLivedToken(shortLivedToken);
    const longLivedToken = longLivedTokenData.access_token;
    const expiresIn = longLivedTokenData.expires_in;

    // Buscar Páginas do Facebook do usuário
    const pagesData = await getUserFacebookPages(longLivedToken);
    if (!pagesData.data || pagesData.data.length === 0) {
      console.error('[INSTAGRAM CALLBACK] Nenhuma página do Facebook encontrada');
      return redirectWithClearedCookie(`${APP_URL}/?instagram=error&msg=sem_paginas_facebook`);
    }

    const page = pagesData.data[0];
    const pageId = page.id;
    const pageAccessToken = page.access_token;

    // Buscar conta Instagram Business vinculada à página
    const igAccount = await getInstagramBusinessAccount(pageAccessToken, pageId);
    const igUserId = igAccount.id;
    const igUsername = igAccount.username;

    // Calcular expiração do token
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    // Salvar no banco de dados
    await db.instagramToken.upsert({
      where: { userId },
      update: {
        igUserId,
        igUsername,
        fbPageId: pageId,
        fbPageAccessToken: pageAccessToken,
        igAccessToken: longLivedToken,
        tokenExpiresAt,
        connectedAt: new Date(),
      },
      create: {
        userId,
        igUserId,
        igUsername,
        fbPageId: pageId,
        fbPageAccessToken: pageAccessToken,
        igAccessToken: longLivedToken,
        tokenExpiresAt,
        connectedAt: new Date(),
      },
    });

    return redirectWithClearedCookie(`${APP_URL}/?instagram=connected`);
  } catch (error) {
    console.error('[INSTAGRAM CALLBACK] Erro no callback OAuth:', error);
    return redirectWithClearedCookie(`${APP_URL}/?instagram=error&msg=erro_interno`);
  }
}
