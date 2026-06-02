/**
 * Utilitários para formatação e geração de links de contato
 * (WhatsApp e ligação telefônica).
 */

/**
 * Limpa um número de telefone brasileiro removendo todos os caracteres
 * não numéricos (parênteses, traços, espaços, etc.)
 *
 * Exemplos:
 *   "(11) 99999-9999" → "11999999999"
 *   "+55 11 99999-9999" → "5511999999999"
 */
export function cleanPhoneNumber(phone: string): string {
  return phone.replace(/\D/g, '')
}

/**
 * Formata o número para o padrão de exibição brasileiro
 * Exemplos:
 *   "11999999999" → "(11) 99999-9999"
 *   "5511999999999" → "+55 (11) 99999-9999"
 */
export function formatPhoneNumber(phone: string): string {
  const digits = cleanPhoneNumber(phone)
  if (digits.length <= 2) return digits
  if (digits.length <= 7) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  }
  if (digits.length <= 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  }
  // Com código país (+55)
  if (digits.length <= 13) {
    const ddd = digits.slice(-11, -9)
    const prefix = digits.slice(-9, -4)
    const suffix = digits.slice(-4)
    const countryCode = digits.slice(0, digits.length - 11)
    return `+${countryCode} (${ddd}) ${prefix}-${suffix}`
  }
  return phone
}

/**
 * Gera a URL do WhatsApp para abrir conversa com o número informado.
 * O link abre diretamente no WhatsApp Web (desktop) ou no app (mobile).
 *
 * Formato: https://wa.me/5511999999999
 *
 * @param phone - Número de telefone cadastrado
 * @returns URL do WhatsApp ou null se o número for inválido
 */
export function getWhatsAppUrl(phone: string): string | null {
  const digits = cleanPhoneNumber(phone)
  // Precisa ter pelo menos DDD + número (mínimo 10 dígitos)
  if (digits.length < 10 && digits.length < 12) return null

  // Se não começa com código país, adiciona +55 (Brasil)
  const number = digits.startsWith('55') || digits.length > 11
    ? digits
    : `55${digits}`

  return `https://wa.me/${number}`
}

/**
 * Gera a URL de ligação telefônica (tel: link).
 * No mobile, abre diretamente o discador. No desktop, pode abrir
 * aplicativos como FaceTime, Skype, etc.
 *
 * @param phone - Número de telefone cadastrado
 * @returns URL tel: ou null se o número for inválido
 */
export function getPhoneCallUrl(phone: string): string | null {
  const digits = cleanPhoneNumber(phone)
  if (digits.length < 8) return null

  // Adiciona +55 se não tem código país
  const number = digits.length > 11 ? digits : `+55${digits}`

  return `tel:${number}`
}

/**
 * Retorna true se o dispositivo parece ser mobile (baseado no User-Agent).
 * Usado para decidir se mostra botão de ligação (mobile) ou apenas WhatsApp.
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent || navigator.vendor
  return /android|iphone|ipad|ipod|mobile/i.test(ua)
}
