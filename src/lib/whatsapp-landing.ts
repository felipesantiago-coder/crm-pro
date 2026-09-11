/**
 * WhatsApp Landing "Clique para Entrar" — lógica pura compartilhada
 * entre a API admin (/api/whatsapp-landings), a página pública
 * (/lp/[slug]) e o redirect contabilizado (/lp/[slug]/go).
 *
 * Regras de produto:
 *  - A página é mínima: um botão centralizado que abre a conversa
 *    de WhatsApp no número informado pelo admin com mensagem padrão.
 *  - A mensagem padrão é exatamente
 *    "Olá, gostaria de conhecer outras opções na região".
 *  - A mensagem suporta o placeholder {regiao}, substituído pela
 *    região vinculada à landing (ex.: "...opções na região {regiao}").
 */

/** Mensagem padrão do pedido de produto (usada quando o admin salva vazia). */
export const DEFAULT_WHATSAPP_LANDING_MESSAGE =
  'Olá, gostaria de conhecer outras opções na região';

/** Placeholder suportado dentro da mensagem para interpolar a região. */
export const REGION_PLACEHOLDER = '{regiao}';

/** Slugs seguem a mesma convenção das landings de empreendimento. */
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidLandingSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

/** Caminho público da landing (link copiado para o anúncio). */
export function landingPublicPath(slug: string): string {
  return `/lp/${slug}`;
}

/**
 * Normaliza o número informado pelo admin para o formato exigido pelo
 * wa.me: apenas dígitos, SEMPRE com DDI (55 para números nacionais).
 *
 * Aceita: "(11) 99999-9999", "11 99999-9999", "11999999999",
 * "+55 11 99999-9999", "5511999999999".
 */
export function normalizeLandingPhone(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const digits = input.replace(/\D/g, '');
  if (!digits) return { ok: false, error: 'Informe o número do WhatsApp' };
  // Sem DDI (10 fixo ou 11 móvel nacional) → prefixa 55
  if (digits.length >= 10 && digits.length <= 11) {
    return { ok: true, value: `55${digits}` };
  }
  // Já com DDI 55 (12-13 dígitos)
  if (digits.length >= 12 && digits.length <= 13 && digits.startsWith('55')) {
    return { ok: true, value: digits };
  }
  return {
    ok: false,
    error: 'Número inválido — use DDD + número (ex.: (11) 99999-9999)',
  };
}

/**
 * Resolve a mensagem final da conversa:
 *  - vazia/whitespace → mensagem padrão do produto;
 *  - contendo {regiao} → substitui pela região da landing.
 */
export function resolveLandingMessage(message: string | null | undefined, region: string): string {
  const trimmed = (message ?? '').trim();
  const base = trimmed || DEFAULT_WHATSAPP_LANDING_MESSAGE;
  return base.replaceAll(REGION_PLACEHOLDER, region);
}

/** Monta a URL wa.me com mensagem pré-preenchida. Requer telefone normalizado. */
export function buildLandingWhatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

/** Mesma regra de slug das landings de empreendimento (acentos → ascii). */
export function generateLandingSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}
