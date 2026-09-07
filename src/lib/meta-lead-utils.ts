/**
 * Utilitários compartilhados para processamento de leads do Meta.
 * Usado pelo webhook, import-manual e import-by-form.
 */

// ── Campos de CONTATO padrão do Meta (seção "Informações de contato" do
// formulário) — NUNCA são perguntas: não entram nas "Respostas do
// formulário" (cartão/notes) e não participam da temperatura do lead ──
// Lista completa das chaves canônicas que o Meta envia no field_data
// (full_name, email, phone_number, zip_code, state, dob, gender,
// custom_disclaimer...) + variantes PT-BR usadas em importações.
// Normalizados da MESMA forma que os nomes dos campos (sem _, -, espaços,
// minúsculas) para que a comparação funcione: "full_name" → "fullname".

const STANDARD_FIELDS = new Set(
  [
    // Nome (chaves canônicas do Meta + variantes PT-BR)
    'full_name', 'first_name', 'last_name', 'name',
    'nome', 'nome_completo', 'primeiro_nome', 'sobrenome', 'ultimo_nome',
    // E-mail
    'email', 'e_mail', 'work_email', 'email_corporativo',
    // Telefone
    'phone_number', 'phone', 'work_phone_number', 'work_phone',
    'telefone', 'celular',
    // Endereço / localidade
    'street_address', 'address', 'endereco', 'endereço',
    'city', 'cidade', 'state', 'estado', 'uf',
    'zip_code', 'zip', 'postal_code', 'cep',
    'country', 'pais', 'país',
    // Perfil
    'dob', 'birthdate', 'data_de_nascimento', 'data_de_nasc', 'nascimento',
    'gender', 'genero', 'gênero', 'sexo',
    'marital_status', 'estado_civil', 'military_status',
    'education', 'escolaridade',
    'company_name', 'company', 'empresa',
    'job_name', 'job_title', 'job_role', 'cargo',
    // Compliance e campos de sistema do formulário Meta
    'custom_disclaimer', 'disclaimer', 'calendar_event', 'store_code',
  ].map((f) => f.toLowerCase().replace(/[_\s-]/g, '')),
);

/**
 * true quando a chave do campo é um dado de CONTATO padrão de formulário
 * Meta (nome, e-mail, telefone, endereço, perfil, compliance...).
 * Dados de contato NUNCA são perguntas — não pontuam na temperatura do
 * lead nem aparecem como perguntas configuráveis no painel.
 */
export function isMetaContactField(key: string): boolean {
  if (!key) return false;
  return STANDARD_FIELDS.has(String(key).toLowerCase().replace(/[_\s-]/g, ''));
}

// ── Campos de RASTREAMENTO (campos ocultos pré-preenchidos do formulário
// Meta: utm_source, utm_medium, utm_campaign, utm_adset, utm_ad, placement,
// ids de campanha/conjunto/anúncio...) — não são perguntas do lead: não
// pontuam na temperatura (o CRM já registra a campanha real via API) ──

/**
 * true quando a chave é um campo de RASTREAMENTO do formulário Meta
 * (utm_*, placement, ids/nomes de campanha, conjunto e anúncio).
 * Campos de rastreamento NUNCA são perguntas — não participam da
 * classificação de temperatura do lead.
 */
export function isMetaTrackingField(key: string): boolean {
  if (!key) return false;
  const normalized = String(key).toLowerCase().replace(/[_\s-]/g, '');
  if (normalized.startsWith('utm')) return true; // utm_source, utm_medium, utm_campaign, utm_adset...
  return [
    'placement',
    'campaignid', 'campaignname',
    'adsetid', 'adsetname',
    'adid', 'adname',
    'pagename', 'pageid',
    'formname',
  ].includes(normalized);
}

// ── Parâmetros dinâmicos NÃO resolvidos pelo Meta ──
// Campos ocultos pré-preenchidos com {{campaign.name}}, {{adset.name}} etc.
// são expandidos PELO APLICATIVO Meta/Instagram no momento em que o
// formulário abre — quando isso falha (acesso orgânico, navegador/webview,
// versão do app, posicionamento sem suporte), o texto literal "{{...}}" é
// enviado no field_data. Esse valor NÃO tem informação nenhuma.

const RE_UNRESOLVED_META_PARAM = /\{\{[^}]*\}\}/;

/**
 * true quando o valor é um parâmetro dinâmico do Meta que NÃO foi
 * resolvido (contém "{{...}}", ex.: "{{campaign.name}}") — não há
 * informação real nele, então não deve ser armazenado/exibido.
 */
export function isUnresolvedMetaParam(value: string): boolean {
  if (!value) return false;
  return RE_UNRESOLVED_META_PARAM.test(String(value));
}

export interface RawLeadAnswer {
  key: string;
  values: string[];
}

/**
 * Extrai as PERGUNTAS do formulário (field_data) preservando:
 *   - a ordem original do formulário;
 *   - TODOS os valores de múltipla escolha (values[]), nunca só o primeiro.
 * Descarta:
 *   - campos de contato do Meta (nome, e-mail, telefone, cidade, CEP...);
 *   - valores de parâmetros dinâmicos NÃO resolvidos ("{{campaign.name}}" etc.)
 *     — o app Meta não os expandiu, logo não há informação neles.
 * Usado pelo cartão de notificação (contrato TelegramLeadNotificationInput).
 */
export function extractRawAnswers(
  fieldData: Array<{ name: string; values?: string[] }>,
): RawLeadAnswer[] {
  const answers: RawLeadAnswer[] = [];

  for (const field of fieldData) {
    const normalizedName = field.name.toLowerCase().replace(/[_\s-]/g, '');

    // Pular dados de contato — não são perguntas do formulário
    if (STANDARD_FIELDS.has(normalizedName)) continue;

    const values = (field.values || [])
      .map((v) => String(v).trim())
      .filter(Boolean)
      // Parâmetros dinâmicos não resolvidos ("{{campaign.name}}") não têm informação
      .filter((v) => !isUnresolvedMetaParam(v));

    if (values.length > 0) {
      answers.push({ key: field.name, values });
    }
  }

  return answers;
}

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
 * Extrai as perguntas/respostas do field_data (dados de contato do Meta —
 * nome, e-mail, telefone, cidade, CEP, estado etc. — são excluídos).
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
    if (value && String(value).trim() !== '' && !isUnresolvedMetaParam(String(value))) {
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
