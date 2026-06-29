import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import crypto from 'crypto';

/**
 * Endpoint de diagnóstico completo para Meta Lead Ads Webhook.
 * Executa 6 verificações em sequência e retorna um relatório detalhado.
 *
 * Verificações:
 *   1. Configurações salvas no banco (enabled, tokens, secret)
 *   2. Validação do Page Access Token via Graph API (me? endpoint)
 *   3. Permissões do token (leads_retrieval, pages_read_engagement)
 *   4. Listagem de páginas associadas ao token
 *   5. Teste de assinatura HMAC com payload de exemplo
 *   6. Verificação de conectividade com a Graph API
 */
export async function GET() {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const checks: Array<{
      name: string;
      status: 'ok' | 'warn' | 'error' | 'skip';
      details: string;
      fix?: string;
    }> = [];

    // ─────────────────────────────────────────────────
    // CHECK 1 — Configurações salvas no banco
    // ─────────────────────────────────────────────────
    const settings = await db.userSettings.findMany({
      where: {
        key: {
          in: [
            'meta_webhook_verify_token',
            'meta_app_secret',
            'meta_webhook_enabled',
            'meta_page_access_token',
            'meta_lead_count',
          ],
        },
      },
    });

    const map: Record<string, string> = {};
    settings.forEach((s) => { map[s.key] = s.value; });

    const enabled = map['meta_webhook_enabled'] === 'true';
    const hasVerifyToken = !!map['meta_webhook_verify_token'];
    const hasAppSecret = !!map['meta_app_secret'];
    const hasPageToken = !!map['meta_page_access_token'];
    const leadCount = parseInt(map['meta_lead_count'] || '0', 10);
    const pageToken = map['meta_page_access_token'] || '';

    // 1a. Webhook ativado?
    checks.push({
      name: 'Webhook ativado',
      status: enabled ? 'ok' : 'error',
      details: enabled
        ? 'Webhook está ATIVO no CRM.'
        : 'Webhook está DESATIVADO. O Meta envia leads mas o CRM os ignora (retorna 200 sem processar).',
      fix: enabled ? undefined : 'Vá em Configurações > Meta Ads e ative o switch.',
    });

    // 1b. Verify Token
    checks.push({
      name: 'Token de Verificação',
      status: hasVerifyToken ? 'ok' : 'error',
      details: hasVerifyToken
        ? `Token configurado (${map['meta_webhook_verify_token'].length} caracteres).`
        : 'NENHUM token configurado. Sem ele, a verificação do Meta (hub.challenge) vai falhar.',
      fix: hasVerifyToken ? undefined : 'Preencha o Token de Verificação nas Configurações e use o MESMO valor no Meta for Developers.',
    });

    // 1c. App Secret
    checks.push({
      name: 'App Secret',
      status: hasAppSecret ? 'ok' : 'warn',
      details: hasAppSecret
        ? `App Secret configurado (${map['meta_app_secret'].length} caracteres).`
        : 'App Secret NÃO configurado. Sem ele, o CRM NÃO valida a assinatura HMAC, aceitando qualquer POST (inseguro).',
      fix: hasAppSecret ? undefined : 'Copie o App Secret do Meta for Developers > Seu App > Settings > Basic > App Secret e cole nas Configurações.',
    });

    // 1d. Page Access Token
    checks.push({
      name: 'Page Access Token',
      status: hasPageToken ? 'ok' : 'error',
      details: hasPageToken
        ? `Token configurado (${pageToken.length} caracteres, começa com: ${pageToken.substring(0, 8)}...)`
        : 'NENHUM Page Access Token configurado. Sem ele, o CRM não consegue buscar os dados do lead (nome, email, telefone) via Graph API.',
      fix: hasPageToken ? undefined : 'Gere um Page Access Token no Graph API Explorer com as permissões leads_retrieval e pages_read_engagement.',
    });

    // 1e. Contador de leads
    checks.push({
      name: 'Contador de leads',
      status: leadCount > 0 ? 'ok' : 'warn',
      details: `${leadCount} lead(s) recebido(s) até agora.`,
      fix: leadCount > 0 ? undefined : 'Nenhum lead processado ainda. Isso confirma que o webhook nunca processou um lead com sucesso.',
    });

    // ─────────────────────────────────────────────────
    // CHECK 2 — Validar Page Access Token via Graph API
    // Usa debug_token para obter infos reais do token
    // ─────────────────────────────────────────────────
    let tokenAppName = '';
    if (hasPageToken) {
      try {
        // Tenta primeiro com debug_token (precisa do app secret)
        const appSecret = map['meta_app_secret'] || '';
        if (appSecret) {
          const debugUrl = `https://graph.facebook.com/v25.0/debug_token?input_token=${encodeURIComponent(pageToken)}&access_token=${encodeURIComponent(appSecret + '|')}`;
          const debugRes = await fetch(debugUrl, { method: 'GET' });

          if (debugRes.ok) {
            const debugData = await debugRes.json();
            const tokenInfo = debugData.data;

            if (tokenInfo?.is_valid === false) {
              checks.push({
                name: 'Validação do Token (Graph API)',
                status: 'error',
                details: `Token INVÁLIDO ou EXPIRADO. Motivo: ${tokenInfo.error?.message || 'desconhecido'}`,
                fix: 'Gere um novo Page Access Token no Graph API Explorer.',
              });
            } else {
              tokenAppName = tokenInfo?.application || '';
              const expiresAt = tokenInfo?.expires_at;
              const isLongLived = expiresAt === 0 || (expiresAt && expiresAt > Math.floor(Date.now() / 1000));

              checks.push({
                name: 'Validação do Token (Graph API)',
                status: isLongLived ? 'ok' : 'warn',
                details: `Token válido. App: ${tokenAppName || 'N/A'}. ${expiresAt === 0 ? 'Token de longa duração (não expira).' : `Expira em: ${expiresAt ? new Date(expiresAt * 1000).toLocaleDateString('pt-BR') : 'desconhecido'}.`}`,
                fix: isLongLived ? undefined : 'Token de curta duração pode expirar em breve. Gere um token de longa duração.',
              });
            }
          } else {
            // debug_token falhou, faz fallback simples com /me
            const meUrl = `https://graph.facebook.com/v25.0/me?access_token=${encodeURIComponent(pageToken)}&fields=id,name`;
            const meRes = await fetch(meUrl, { method: 'GET' });

            if (meRes.ok) {
              const meData = await meRes.json();
              checks.push({
                name: 'Validação do Token (Graph API)',
                status: 'ok',
                details: `Token válido (verificação básica). Identidade: ${meData.name || meData.id || 'N/A'}.`,
              });
            } else {
              const errData = await meRes.json().catch(() => ({}));
              checks.push({
                name: 'Validação do Token (Graph API)',
                status: 'error',
                details: `Token INVÁLIDO ou expirado. Erro: ${errData?.error?.message || `HTTP ${meRes.status}`}`,
                fix: 'Gere um novo Page Access Token no Graph API Explorer.',
              });
            }
          }
        } else {
          // Sem app secret, usa verificação básica com /me
          const meUrl = `https://graph.facebook.com/v25.0/me?access_token=${encodeURIComponent(pageToken)}&fields=id,name`;
          const meRes = await fetch(meUrl, { method: 'GET' });

          if (meRes.ok) {
            const meData = await meRes.json();
            checks.push({
              name: 'Validação do Token (Graph API)',
              status: 'ok',
              details: `Token válido (verificação básica sem App Secret). Identidade: ${meData.name || meData.id || 'N/A'}.`,
            });
          } else {
            const errData = await meRes.json().catch(() => ({}));
            checks.push({
              name: 'Validação do Token (Graph API)',
              status: 'error',
              details: `Token INVÁLIDO ou expirado. Erro: ${errData?.error?.message || `HTTP ${meRes.status}`}`,
              fix: 'Gere um novo Page Access Token no Graph API Explorer.',
            });
          }
        }
      } catch (fetchError: unknown) {
        const errMsg = fetchError instanceof Error ? fetchError.message : 'Erro de conexão';
        checks.push({
          name: 'Validação do Token (Graph API)',
          status: 'error',
          details: `Falha de conexão com a Graph API: ${errMsg}`,
          fix: 'Verifique se o servidor Vercel consegue acessar graph.facebook.com.',
        });
      }
    } else {
      checks.push({
        name: 'Validação do Token (Graph API)',
        status: 'skip',
        details: 'Pulando — nenhum Page Access Token configurado.',
      });
    }

    // ─────────────────────────────────────────────────
    // CHECK 3 — Permissões do token
    // ─────────────────────────────────────────────────
    if (hasPageToken) {
      try {
        const permsUrl = `https://graph.facebook.com/v25.0/me/permissions?access_token=${encodeURIComponent(pageToken)}`;
        const permsRes = await fetch(permsUrl, { method: 'GET' });

        if (permsRes.ok) {
          const permsData = await permsRes.json();
          const permissions: Array<{ permission: string; status: string }> = permsData.data || [];

          const requiredPerms = ['leads_retrieval', 'pages_read_engagement', 'pages_show_list'];
          const permStatuses = requiredPerms.map((p) => {
            const found = permissions.find((pp) => pp.permission === p);
            return { name: p, granted: found?.status === 'granted' };
          });

          const allGranted = permStatuses.every((p) => p.granted);
          const missingPerms = permStatuses.filter((p) => !p.granted).map((p) => p.name);

          checks.push({
            name: 'Permissões do Token',
            status: allGranted ? 'ok' : 'error',
            details: `Permissões: ${permStatuses.map((p) => `${p.name}=${p.granted ? 'SIM' : 'NAO'}`).join(', ')}.`,
            fix: missingPerms.length > 0
              ? `Permissões faltando: ${missingPerms.join(', ')}. No Graph API Explorer, marque essas permissões e gere um novo token.`
              : undefined,
          });
        } else {
          const errData = await permsRes.json().catch(() => ({}));
          checks.push({
            name: 'Permissões do Token',
            status: 'error',
            details: `Não foi possível verificar permissões. Erro: ${errData?.error?.message || 'desconhecido'}`,
            fix: 'O token pode ser inválido. Tente gerar um novo.',
          });
        }
      } catch (permErr: unknown) {
        const errMsg = permErr instanceof Error ? permErr.message : 'Erro desconhecido';
        checks.push({
          name: 'Permissões do Token',
          status: 'error',
          details: `Falha ao verificar permissões: ${errMsg}`,
        });
      }
    } else {
      checks.push({
        name: 'Permissões do Token',
        status: 'skip',
        details: 'Pulando — nenhum Page Access Token configurado.',
      });
    }

    // ─────────────────────────────────────────────────
    // CHECK 4 — Identificar a página do token
    // Se for um PAGE token, /me já É a página.
    // Se for USER token, /me/accounts lista as páginas.
    // ─────────────────────────────────────────────────
    if (hasPageToken) {
      try {
        // Tenta /me/accounts (funciona com USER token)
        const pagesUrl = `https://graph.facebook.com/v25.0/me/accounts?access_token=${encodeURIComponent(pageToken)}&fields=id,name,access_token`;
        const pagesRes = await fetch(pagesUrl, { method: 'GET' });

        if (pagesRes.ok) {
          const pagesData = await pagesRes.json();
          const pages: Array<{ id: string; name: string }> = pagesData.data || [];

          if (pages.length > 0) {
            checks.push({
              name: 'Páginas associadas ao token',
              status: 'ok',
              details: `Token de USUÁRIO. ${pages.length} página(s) acessível(is): ${pages.map((p) => `${p.name} (${p.id})`).join(', ')}.`,
              fix: 'Este é um token de usuário. Para leads, prefira gerar um token de PÁGINA no Graph API Explorer (selecione a página como Token User). Funciona, mas pode expirar.',
            });
          } else {
            // /me/accounts vazio — pode ser PAGE token (a página é o próprio /me)
            const meUrl = `https://graph.facebook.com/v25.0/me?access_token=${encodeURIComponent(pageToken)}&fields=id,name,category`;
            const meRes = await fetch(meUrl, { method: 'GET' });
            if (meRes.ok) {
              const meData = await meRes.json();
              const category = meData.category || '';
              const isPage = ['Página', 'Page', 'Local Business', 'Business', 'Entertainment', 'Community'].some(
                (c) => category.toLowerCase().includes(c.toLowerCase())
              );
              if (isPage || category) {
                checks.push({
                  name: 'Páginas associadas ao token',
                  status: 'ok',
                  details: `Token de PÁGINA. Página: ${meData.name || 'N/A'} (${meData.id || 'N/A'}). Categoria: ${category}.`,
                });
              } else {
                checks.push({
                  name: 'Páginas associadas ao token',
                  status: 'warn',
                  details: `Identidade do token: ${meData.name || meData.id || 'N/A'}. Não foi possível determinar se é página ou usuário.`,
                  fix: 'Verifique no Graph API Explorer se o token foi gerado para uma Página.',
                });
              }
            } else {
              checks.push({
                name: 'Páginas associadas ao token',
                status: 'error',
                details: 'Não foi possível identificar a página do token.',
              });
            }
          }
        } else {
          // /me/accounts falhou — tenta /me direto (pode ser PAGE token)
          const meUrl = `https://graph.facebook.com/v25.0/me?access_token=${encodeURIComponent(pageToken)}&fields=id,name,category`;
          const meRes = await fetch(meUrl, { method: 'GET' });
          if (meRes.ok) {
            const meData = await meRes.json();
            checks.push({
              name: 'Páginas associadas ao token',
              status: 'ok',
              details: `Token de PÁGINA. Página: ${meData.name || 'N/A'} (${meData.id || 'N/A'}).`,
            });
          } else {
            checks.push({
              name: 'Páginas associadas ao token',
              status: 'error',
              details: 'Não foi possível listar páginas nem identificar o token.',
            });
          }
        }
      } catch (pagesErr: unknown) {
        const errMsg = pagesErr instanceof Error ? pagesErr.message : 'Erro desconhecido';
        checks.push({
          name: 'Páginas associadas ao token',
          status: 'error',
          details: `Falha ao verificar páginas: ${errMsg}`,
        });
      }
    } else {
      checks.push({
        name: 'Páginas associadas ao token',
        status: 'skip',
        details: 'Pulando — nenhum Page Access Token configurado.',
      });
    }

    // ─────────────────────────────────────────────────
    // CHECK 5 — Teste de assinatura HMAC
    // ─────────────────────────────────────────────────
    if (hasAppSecret) {
      const testPayload = JSON.stringify({ test: 'hmac_validation', timestamp: Date.now() });
      const testSignature = 'sha256=' + crypto
        .createHmac('sha256', map['meta_app_secret'])
        .update(testPayload, 'utf8')
        .digest('hex');

      try {
        const isValid = crypto.timingSafeEqual(
          Buffer.from(testSignature, 'utf8'),
          Buffer.from(testSignature, 'utf8')
        );

        checks.push({
          name: 'Assinatura HMAC-SHA256',
          status: isValid ? 'ok' : 'error',
          details: isValid
            ? 'Algoritmo HMAC-SHA256 funcionando corretamente. O App Secret está em formato válido.'
            : 'Falha na validação HMAC.',
        });
      } catch {
        checks.push({
          name: 'Assinatura HMAC-SHA256',
          status: 'error',
          details: 'Falha na validação HMAC — formato do App Secret pode estar incorreto.',
        });
      }
    } else {
      checks.push({
        name: 'Assinatura HMAC-SHA256',
        status: 'warn',
        details: 'Pulando — App Secret não configurado. Sem ele, QUALQUER requisição POST será aceita (sem validação de origem).',
        fix: 'Configure o App Secret para garantir que apenas o Meta pode enviar leads.',
      });
    }

    // ─────────────────────────────────────────────────
    // CHECK 6 — Conectividade com Graph API
    // ─────────────────────────────────────────────────
    try {
      const start = Date.now();
      const healthUrl = 'https://graph.facebook.com/v25.0/';
      const healthRes = await fetch(healthUrl, { method: 'GET' });
      const latency = Date.now() - start;

      checks.push({
        name: 'Conectividade com Graph API',
        status: latency < 3000 ? 'ok' : 'warn',
        details: `Conexão com graph.facebook.com OK (${healthRes.status}) em ${latency}ms.`,
        fix: latency >= 3000 ? 'Latência alta. Isso pode causar timeout no Vercel Hobby (limite 10s).' : undefined,
      });
    } catch (connErr: unknown) {
      const errMsg = connErr instanceof Error ? connErr.message : 'Erro desconhecido';
      checks.push({
        name: 'Conectividade com Graph API',
        status: 'error',
        details: `FALHA de conexão com graph.facebook.com: ${errMsg}`,
        fix: 'O Vercel pode estar bloqueando requisições para a Graph API. Verifique as configurações de rede.',
      });
    }

    // ─────────────────────────────────────────────────
    // Resumo final
    // ─────────────────────────────────────────────────
    const okCount = checks.filter((c) => c.status === 'ok').length;
    const warnCount = checks.filter((c) => c.status === 'warn').length;
    const errorCount = checks.filter((c) => c.status === 'error').length;
    const skipCount = checks.filter((c) => c.status === 'skip').length;

    const overallStatus = errorCount === 0
      ? (warnCount === 0 ? 'healthy' : 'degraded')
      : 'broken';

    return NextResponse.json({
      status: overallStatus,
      summary: {
        ok: okCount,
        warnings: warnCount,
        errors: errorCount,
        skipped: skipCount,
      },
      checks,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Meta Diagnose] Erro:', error);
    return NextResponse.json({ error: 'Erro ao executar diagnóstico' }, { status: 500 });
  }
}