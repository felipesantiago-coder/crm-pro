// ============================================================
// META OAUTH — feedback pós-conexão (URL → mensagens de toast).
// Arquivo SEPARADO de meta-oauth.ts para ser importável pelo CLIENT
// (sem crypto/fetch/node builtins). Lógica pura, testável.
// ============================================================

export interface OAuthFeedback {
  kind: 'success' | 'warning' | 'error';
  message: string;
}

/** Converte os params de retorno do callback em mensagens prontas.
 *  `params`: objeto simples (entries() do URLSearchParams no client). */
export function describeMetaOAuthFeedback(params: Record<string, string | null>): OAuthFeedback[] {
  const out: OAuthFeedback[] = [];
  const ok = params['meta_oauth'];
  const err = params['meta_oauth_error'];
  const detail = params['detail'];
  const scopes = params['scopes'];
  const accounts = params['accounts'];
  const skipped = params['skipped'];
  const name = params['name'];
  const shortLived = params['short_lived'] === '1';

  if (ok === 'connected') {
    const parts: string[] = [];
    parts.push(`${parseInt(accounts || '0', 10) || 0} conta(s) de anúncios conectada(s) via Facebook`);
    if (parseInt(skipped || '0', 10) > 0) parts.push(`${skipped} já cadastrada(s) — mantida(s)`);
    out.push({ kind: shortLived ? 'warning' : 'success', message: parts.join('; ') + (shortLived ? '. ATENÇÃO: token de CURTA duração (a extensão para longa duração falhou) — renove em até 1h.' : '') });
  } else if (ok === 'reconnected') {
    out.push({ kind: 'success', message: `Token Meta renovado${name ? ` para "${name}"` : ''} — captação retomada.` });
  }

  if (err) {
    switch (err) {
      case 'access_denied':
        out.push({ kind: 'error', message: 'Conexão cancelada na tela do Facebook — nenhuma conta foi conectada.' });
        break;
      case 'unauthorized':
        out.push({ kind: 'error', message: 'Apenas administradores podem conectar contas Meta.' });
        break;
      case 'not_configured':
        out.push({ kind: 'error', message: 'OAuth Meta não configurado: defina META_APP_ID e META_APP_SECRET no ambiente (ou cadastre um App Secret verificado em uma conta de anúncios).' });
        break;
      case 'app_credentials':
        out.push({ kind: 'error', message: `App ID/App Secret rejeitados pela Meta${detail ? `: ${detail}` : '.'}` });
        break;
      case 'redirect_mismatch':
        out.push({ kind: 'error', message: 'A Meta rejeitou o redirect_uri. Cadastre a URL do callback em Meta for Developers → Facebook Login for Business → Settings → Valid OAuth Redirect URIs (valor exato mostrado no CRM).' });
        break;
      case 'code_invalid_or_used':
        out.push({ kind: 'error', message: 'Código de autorização inválido ou já utilizado — clique em Conectar novamente.' });
        break;
      case 'missing_permissions':
        out.push({
          kind: 'error',
          message:
            `Permissões NÃO concedidas: ${scopes || '?'}.\n` +
            'Causas mais comuns: (1) o app ainda não tem Advanced Access aprovado no App Review — sem isso a Meta OMITE a permissão do diálogo para quem não é admin/developer/tester do app; (2) a permissão foi desmarcada na tela de consentimento.\n' +
            'Corrija no App Review (docs/meta-app-review-checklist.md) e conecte novamente.',
        });
        break;
      case 'app_mismatch':
        out.push({ kind: 'error', message: `O token foi emitido para outro app (${detail}) — confira META_APP_ID vs App Secret cadastrado.` });
        break;
      case 'no_ad_accounts':
        out.push({ kind: 'error', message: 'Nenhuma conta de anúncios ATIVA foi compartilhada na autorização — verifique se o usuário tem papel (Anunciante+) nas contas e as marcou no seletor de ativos.' });
        break;
      case 'all_accounts_exist':
        out.push({ kind: 'error', message: `As contas autorizadas já estavam cadastradas no CRM${detail ? ` — ${detail}` : '.'}` });
        break;
      case 'account_not_found':
        out.push({ kind: 'error', message: 'Conta a reconectar não encontrada (removida?) — conecte-a como nova.' });
        break;
      case 'invalid_state':
        out.push({ kind: 'error', message: 'Sessão do OAuth expirada ou inválida (state) — tente conectar de novo.' });
        break;
      case 'server_error':
        out.push({ kind: 'error', message: 'A Meta reportou instabilidade durante a autorização — tente novamente em instantes.' });
        break;
      default:
        out.push({ kind: 'error', message: `Falha no OAuth Meta${detail ? `: ${detail}` : ` (${err})`}` });
    }
  }
  return out;
}
