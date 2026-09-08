'use client';

// ============================================================
// META OAUTH — consumo do feedback de retorno no CLIENT.
// Lê ?meta_oauth=... / ?meta_oauth_error=... da URL (contrato do
// callback), converte em toasts e limpa a query da barra de endereço.
// Chamado UMA vez no mount do app (src/app/page.tsx) — funciona em
// qualquer view em que o usuário estiver ao voltar da Meta.
// ============================================================

import { toast } from 'sonner';
import { describeMetaOAuthFeedback } from '@/lib/meta-oauth-feedback';

export function consumeMetaOAuthFeedback(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (!params.get('meta_oauth') && !params.get('meta_oauth_error')) return;

  const raw: Record<string, string | null> = {};
  for (const [k, v] of params.entries()) raw[k] = v;

  for (const feedback of describeMetaOAuthFeedback(raw)) {
    if (feedback.kind === 'success') toast.success(feedback.message);
    else if (feedback.kind === 'warning') toast.warning(feedback.message);
    else toast.error(feedback.message);
  }

  window.history.replaceState({}, '', window.location.pathname);
}
