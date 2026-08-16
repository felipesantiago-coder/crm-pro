/**
 * Utilitários compartilhados para processamento de leads do Meta.
 * Usado pelo webhook, import-manual e import-by-form.
 */

// ── Campos padrão do Meta que mapeamos para colunas do Client ──

const STANDARD_FIELDS = new Set([
  'full_name', 'name', 'nome', 'nome_completo',
  'email', 'e_mail',
  'phone_number', 'phone', 'celular', 'telefone',
  'city', 'cidade',
]);

/**
 * Extrai o valor de um campo do array field_data do Meta.
 * Retorna null se não encontrado.
 */
export function getMetaFieldValue(
  fields: Array<{ name: string; values: string[] }>,
  fieldName: string,
): string | null {
  const field = fields.find(
    (f) =>
      f.name.toLowerCase().replace(/[_\s-]/g, '') ===
      fieldName.toLowerCase().replace(/[_\s-]/g, ''),
  );
  return field?.values?.[0] || null;
}

/**
 * Formata telefone removendo caracteres não numéricos.
 * Para números brasileiros com 11 dígitos começando com 9,
 * adiciona o código do país (+55).
 */
export function formatMetaPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
  if (digits.length === 11 || digits.length === 10) return `+55${digits}`;
  return digits.length > 0 ? `+${digits}` : null;
}

/**
 * Extrai todas as perguntas/respostas customizadas do field_data,
 * excluindo os campos padrão (nome, email, telefone, cidade).
 *
 * Retorna um Record<string, string> pronto para:
 *   - Notificação Telegram (customAnswers)
 *   - Campo notes do cliente
 *   - Descrição da interação
 *
 * Exemplo de retorno:
 *   { "Qual seu orçamento?": "Até R$ 500k", "Prefere qual região?": "Zona Sul" }
 */
export function extractCustomAnswers(
  fieldData: Array<{ name: string; values: string[] }>,
): Record<string, string> {
  const answers: Record<string, string> = {};

  for (const field of fieldData) {
    const normalizedName = field.name.toLowerCase().replace(/[_\s-]/g, '');

    // Pular campos padrão que já são extraídos separadamente
    if (STANDARD_FIELDS.has(normalizedName)) continue;

    const value = field.values?.[0];
    if (value && String(value).trim() !== '') {
      answers[field.name] = String(value).trim();
    }
  }

  return answers;
}

/**
 * Formata as respostas customizadas como texto para incluir em notes/interações.
 * Retorna string vazia se não houver respostas.
 */
export function formatCustomAnswersText(
  customAnswers: Record<string, string>,
): string {
  const entries = Object.entries(customAnswers);
  if (entries.length === 0) return '';

  const lines = entries
    .slice(0, 20) // Máximo 20 campos no texto
    .map(([k, v]) => `  • ${k}: ${v}`)
    .join('\n');

  return '\n\nRespostas do formulário:\n' + lines;
}
