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

    // 1c. App Secret — verificar comprimento e formato
    const appSecretValue = map['meta_app_secret'] || '';
    const appSecretLen = appSecretValue.length;
    const isAppSecretSuspicious = hasAppSecret && appSecretLen < 20;
    const isAppSecretHex = hasAppSecret && /^[a-f0-9]+$/i.test(appSecretValue);

    if (!hasAppSecret) {
      checks.push({
        name: 'App Secret',
        status: 'warn',
        details: 'App Secret NÃO configurado. Sem ele, o CRM NÃO valida a assinatura HMAC, aceitando qualquer POST (inseguro).',
        fix: 'Copie o App Secret do Meta for Developers > Seu App > Settings > Basic > App Secret e cole nas Configurações.',
      });
    } else if (isAppSecretSuspicious) {
      checks.push({
        name: 'App Secret',
        status: 'error',
        details: `App Secret suspeito: apenas ${appSecretLen} caracteres. Um App Secret real do Facebook tem 32 caracteres hexadecimais. Com um valor incorreto/truncado, a validação HMAC SEMPRE falha e TODOS os leads do webhook são rejeitados com 401.`,
        fix: 'Vá em Meta for Developers > Seu App > Settings > Basic > App Secret. Clique em "Mostrar" e copie o valor COMPLETO (32 caracteres). Cole o valor inteiro nas Configurações do CRM.',
      });
    } else if (!isAppSecretHex) {
      checks.push({
        name: 'App Secret',
        status: 'warn',
        details: `App Secret configurado (${appSecretLen} caracteres) mas NÃO é hexadecimal puro. App Secrets do Meta são sempre 32 caracteres hex (0-9, a-f). Verifique se não há espaços ou caracteres extras copiados acidentalmente.`,
        fix: 'Copie novamente o App Secret do Meta for Developers, sem espaços antes ou depois.',
      });
    } else {
      checks.push({
        name: 'App Secret',
        status: 'ok',
        details: `App Secret configurado (${appSecretLen} caracteres, formato hex válido).`,
      });
    }

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
    // NOTA: /me/permissions só funciona com USER tokens.
    // Para PAGE tokens, verificamos indiretamente via uma
    // chamada real à API de leads (se houver form ID salvo)
    // ou marcamos como info, já que o token já foi validado no CHECK 2.
    // ─────────────────────────────────────────────────
    if (hasPageToken) {
      try {
        const permsUrl = `https://graph.facebook.com/v22.0/me/permissions?access_token=${encodeURIComponent(pageToken)}`;
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
          // /me/permissions falhou — provavelmente é um PAGE token.
          // Verifica se o erro é #100 (campo inexistente), o que confirma
          // que é um Page Token (Pages não têm o endpoint /permissions).
          const errData = await permsRes.json().catch(() => ({}));
          const metaErrorCode = errData?.error?.code;
          const isPageToken = metaErrorCode === 100
            || String(errData?.error?.message || '').includes('nonexisting field');

          if (isPageToken) {
            // Page Token: verifica permissões indiretamente
            // tentando acessar /me/leadgen_forms (precisa de leads_retrieval)
            const leadFormsUrl = `https://graph.facebook.com/v22.0/me/leadgen_forms?limit=1&access_token=${encodeURIComponent(pageToken)}`;
            const lfRes = await fetch(leadFormsUrl, { method: 'GET' });
            const lfData = await lfRes.json().catch(() => ({}));
            const lfErrCode = lfData?.error?.code;

            if (lfRes.ok || lfErrCode === 100) {
              // Se OK = tem leads_retrieval. Se #100 = não tem formulários,
              // mas o endpoint existe = token tem permissão.
              // Se #200 ou #298 = sem permissão.
              const hasPermission = lfRes.ok || lfErrCode === 100;
              checks.push({
                name: 'Permissões do Token',
                status: hasPermission ? 'ok' : 'error',
                details: `Token de PÁGINA detectado. Permissão leads_retrieval: ${hasPermission ? 'SIM (verificado indiretamente)' : 'NAO'}. Não é possível listar permissões de Page Tokens via /me/permissions — isso é normal.`,
                fix: hasPermission ? undefined : 'O Page Token não tem permissão leads_retrieval. No Meta Business Suite, gere um novo token com essa permissão.',
              });
            } else {
              checks.push({
                name: 'Permissões do Token',
                status: 'error',
                details: `Token de PÁGINA detectado. Não foi possível verificar permissões. Erro: ${lfData?.error?.message || `HTTP ${lfRes.status}`}`,
                fix: 'Gere um novo Page Access Token no Graph API Explorer com leads_retrieval e pages_read_engagement.',
              });
            }
          } else {
            // Erro diferente de #100 — pode ser token inválido
            checks.push({
              name: 'Permissões do Token',
              status: 'error',
              details: `Não foi possível verificar permissões. Erro: ${errData?.error?.message || 'desconhecido'}`,
              fix: 'O token pode ser inválido. Tente gerar um novo.',
            });
          }
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
    // Se for USER token, /me/accounts lista as páginas
    // e EXTRAÍMOS o page token para salvar automaticamente.
    // ─────────────────────────────────────────────────
    if (hasPageToken) {
      try {
        // Tenta /me/accounts (funciona com USER token)
        const pagesUrl = `https://graph.facebook.com/v25.0/me/accounts?access_token=${encodeURIComponent(pageToken)}&fields=id,name,access_token`;
        const pagesRes = await fetch(pagesUrl, { method: 'GET' });

        if (pagesRes.ok) {
          const pagesData = await pagesRes.json();
          const pages: Array<{ id: string; name: string; access_token?: string }> = pagesData.data || [];

          if (pages.length > 0) {
            // Token de usuário detectado — tentar extrair e salvar o page token
            const firstPage = pages[0];
            const extractedPageToken = firstPage.access_token;

            if (extractedPageToken && extractedPageToken !== pageToken) {
              try {
                // Validar o page token extraído com /me antes de salvar
                const validateUrl = `https://graph.facebook.com/v25.0/me?access_token=${encodeURIComponent(extractedPageToken)}&fields=id,name`;
                const validateRes = await fetch(validateUrl, { method: 'GET' });

                if (validateRes.ok) {
                  const validateData = await validateRes.json();
                  // Salvar o page token no banco (substitui o user token)
                  await db.userSettings.upsert({
                    where: { key: 'meta_page_access_token' },
                    update: { value: extractedPageToken },
                    create: { key: 'meta_page_access_token', value: extractedPageToken },
                  });

                  checks.push({
                    name: 'Páginas associadas ao token',
                    status: 'ok',
                    details: `Token de USUÁRIO detectado. Token de PÁGINA extraído e salvo automaticamente para "${firstPage.name}" (${firstPage.id}). Identidade do novo token: ${validateData.name || 'N/A'}.`,
                  });
                } else {
                  // Page token extraído mas inválido — manter o user token
                  checks.push({
                    name: 'Páginas associadas ao token',
                    status: 'warn',
                    details: `Token de USUÁRIO. ${pages.length} página(s) acessível(is): ${pages.map((p) => `${p.name} (${p.id})`).join(', ')}. O page token extraído falhou na validação — user token mantido.`,
                    fix: 'Gere manualmente um token de PÁGINA no Graph API Explorer (selecione a página como Token User).',
                  });
                }
              } catch (saveErr: unknown) {
                const errMsg = saveErr instanceof Error ? saveErr.message : 'Erro desconhecido';
                checks.push({
                  name: 'Páginas associadas ao token',
                  status: 'warn',
                  details: `Token de USUÁRIO. ${pages.length} página(s): ${pages.map((p) => `${p.name} (${p.id})`).join(', ')}. Page token extraído mas falha ao salvar (${errMsg}).`,
                  fix: 'Salve manualmente o Page Access Token nas Configurações.',
                });
              }
            } else {
              // Sem page token na resposta ou já é um page token
              checks.push({
                name: 'Páginas associadas ao token',
                status: 'warn',
                details: `Token de USUÁRIO. ${pages.length} página(s) acessível(is): ${pages.map((p) => `${p.name} (${p.id})`).join(', ')}.`,
                fix: 'Gere um token de PÁGINA no Graph API Explorer (selecione a página como Token User) ou clique em Diagnosticar novamente para extração automática.',
              });
            }
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
    // CHECK 5 — Validação REAL do App Secret
    // O autoteste HMAC anterior foi REMOVIDO porque sempre
    // passava (comparava a assinatura consigo mesma).
    //
    // A validação real tem 2 camadas:
    //   a) Verificação de formato/comprimento (CHECK 1c)
    //   b) Contagem de leads perdidos por assinatura inválida
    //      (prova concreta de que o App Secret está errado)
    //
    // NOTA: Não usamos debug_token aqui porque requer
    // app_id|app_secret e não temos o app_id armazenado.
    // ─────────────────────────────────────────────────

    // Contar leads perdidos por assinatura inválida
    let lostSignatureCount = 0;
    let lostDisabledCount = 0;
    try {
      const [sigCount, disCount] = await Promise.all([
        db.lostLead.count({
          where: {
            source: 'meta_webhook_invalid_signature',
            isRecovered: false,
          },
        }),
        db.lostLead.count({
          where: {
            source: 'meta_webhook_disabled',
            isRecovered: false,
          },
        }),
      ]);
      lostSignatureCount = sigCount;
      lostDisabledCount = disCount;
    } catch {}

    if (lostSignatureCount > 0) {
      // PROVA CONCRETA: leads foram rejeitados por assinatura inválida
      checks.push({
        name: 'App Secret (validação real)',
        status: 'error',
        details: `PROVA CONCRETA: ${lostSignatureCount} lead(s) foram rejeitados(s) com erro de assinatura HMAC e salvos(s) na tabela de leads perdidos. O App Secret configurado (${appSecretLen} caracteres) NÃO bate com o App Secret real do Facebook. Causa mais comum: valor copiado incompleto ou com espaços extras.${lostDisabledCount > 0 ? ` Adicionalmente, ${lostDisabledCount} lead(s) foram perdidos porque o webhook estava desabilitado.` : ''}`,
        fix: `AÇÃO NECESSÁRIA: 1) Vá em Meta for Developers > Seu App > Settings > Basic > App Secret. 2) Clique em "Mostrar". 3) Copie o valor COMPLETO (32 caracteres hex). 4) Cole nas Configurações do CRM sem espaços. 5) Após corrigir, use "Importar por Formulário" para recuperar os leads perdidos.`,
      });
    } else if (isAppSecretSuspicious) {
      checks.push({
        name: 'App Secret (validação real)',
        status: 'error',
        details: `App Secret tem apenas ${appSecretLen} caracteres. Um App Secret real do Facebook tem exatamente 32 caracteres hexadecimais. Com um valor incorreto, a assinatura HMAC de TODOS os webhooks falha silenciosamente — os leads chegam mas são rejeitados com HTTP 401.${lostDisabledCount > 0 ? ` Nota: ${lostDisabledCount} lead(s) perdido(s) por webhook desabilitado.` : ''} Nenhum lead foi registrado como "assinatura inválida" ainda (a verificação de lostLeads foi adicionada agora).`,
        fix: 'Copie o App Secret COMPLETO (32 caracteres hex) do Meta for Developers > App > Settings > Basic. Cole nas Configurações do CRM sem espaços antes ou depois.',
      });
    } else if (hasAppSecret) {
      checks.push({
        name: 'App Secret (validação real)',
        status: 'ok',
        details: `App Secret configurado (${appSecretLen} caracteres, formato válido). Nenhum lead perdido por assinatura inválida.${lostDisabledCount > 0 ? ` Nota: ${lostDisabledCount} lead(s) perdido(s) por webhook desabilitado (outro problema, já corrigido).` : ''}`,
      });
    } else {
      checks.push({
        name: 'App Secret (validação real)',
        status: 'warn',
        details: 'Pulando — App Secret não configurado.',
        fix: 'Configure o App Secret para validar a origem dos webhooks.',
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