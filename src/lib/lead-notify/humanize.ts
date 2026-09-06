/**
 * Humanização determinística de perguntas e respostas do formulário Meta.
 *
 * Determinística = sem LLM, sem rede, sem aleatoriedade: mesma entrada →
 * mesma saída. O dado bruto persistido nunca é alterado — a humanização
 * é apenas de apresentação (§10 do prompt mestre).
 *
 * Prioridade dos rótulos:
 *   1. alias oficial do formulário (quando o chamador tiver metadados)
 *   2. alias configurado pelo administrador
 *   3. dicionário de aliases conhecidos (ALIAS_LABELS)
 *   4. humanização determinística da chave original
 */

// ── Normalização de chaves ─────────────────────────────────────

/** Normaliza separadores para comparação segura: `_`, `-`, espaços e casos. */
export function normalizeAnswerKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── Aliases conhecidos (dicionário curado) ─────────────────────

const ALIAS_LABELS: Record<string, string> = {
  // identificadores clássicos do Meta
  full_name: 'Nome',
  name: 'Nome',
  first_name: 'Nome',
  phone_number: 'Telefone',
  email: 'E-mail',
  city: 'Cidade',
  // perguntas comuns em formulários imobiliários
  qual_sua_faixa_de_renda_mensal: 'Faixa de renda mensal',
  qual_faixa_de_renda_mensal: 'Faixa de renda mensal',
  faixa_de_renda_mensal: 'Faixa de renda mensal',
  faixa_de_renda: 'Faixa de renda',
  renda_mensal: 'Renda mensal',
  qual_sua_faixa_de_renda: 'Faixa de renda',
  quando_pretende_comprar: 'Quando pretende comprar',
  prazo_para_compra: 'Prazo para compra',
  possui_fgts: 'Possui FGTS',
  tem_fgts: 'Possui FGTS',
  fgts: 'FGTS',
  melhor_horario_para_contato: 'Melhor horário para contato',
  melhor_dia_para_contato: 'Melhor dia para contato',
  tipo_de_imovel_de_interesse: 'Imóvel de interesse',
  tipo_de_imovel: 'Tipo de imóvel',
  imovel_de_interesse: 'Imóvel de interesse',
  qual_o_tamanho_do_imovel: 'Tamanho do imóvel',
  quantidade_de_quartos: 'Quantidade de quartos',
  quantos_quartos: 'Quantidade de quartos',
  qual_seu_nome_completo: 'Nome completo',
  qual_o_melhor_telefone_para_contato: 'Melhor telefone para contato',
  pretende_usar_financiamento: 'Pretende usar financiamento',
  ja_tem_aprovacao_de_credito: 'Já tem aprovação de crédito',
  valor_de_entrada: 'Valor de entrada',
  regiao_de_interesse: 'Região de interesse',
  bairro_de_interesse: 'Bairro de interesse',
  onde_voce_mora: 'Onde você mora',
  qual_sua_cidade: 'Cidade',
};

/** Palavras-interrogativas iniciais descartadas na humanização (§10.2). */
const LEADING_STOPWORDS = new Set([
  'qual', 'quais', 'sua', 'seu', 'suas', 'seus', 'teu', 'tua', 'teus', 'tuas',
  'voce', 'você', 'vc', 'o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das',
]);

/** Siglas preservadas em maiúsculo na apresentação. */
const ACRONYMS = new Set([
  'fgts', 'cpf', 'cnpj', 'rg', 'cep', 'iptu', 'itbi', 'ltda', 'mei', 'pix',
  'api', 'url', 'tv', 'wifi', 'wi', 'fi', 'ua', 'm2', 'km',
]);

// ── Rótulos ────────────────────────────────────────────────────

/**
 * Converte uma chave técnica (`qual_sua_faixa_de_renda_mensal`) em um
 * rótulo humano e estável (`Faixa de renda mensal`).
 *
 * @param aliasOverride alias oficial do formulário ou configurado pelo admin
 */
export function humanizeAnswerLabel(
  key: string,
  aliasOverride?: string | null,
): string {
  if (aliasOverride && aliasOverride.trim()) return aliasOverride.trim();

  const normalized = normalizeAnswerKey(key);
  if (!normalized) return 'Resposta';

  const alias = ALIAS_LABELS[normalized];
  if (alias) return alias;

  const tokens = normalized.split('_').filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // Só descarta palavras-interrogativas no INÍCIO ("quando" nunca é descartado)
    if (kept.length === 0 && LEADING_STOPWORDS.has(token) && token !== 'quando') continue;
    kept.push(token);
  }
  if (kept.length === 0) kept.push(...tokens);

  const label = kept
    .map((token) => (ACRONYMS.has(token) ? token.toUpperCase() : token))
    .join(' ');

  return sentenceCase(label);
}

/** Caixa de frase: primeira letra maiúscula, resto preservado. */
export function sentenceCase(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  // Só a PRIMEIRA letra da frase é afetada; strings iniciadas por
  // dígitos/símbolos permanecem como estão (não vira título).
  if (!/^\p{L}/u.test(trimmed)) return trimmed;
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

// ── Valores ────────────────────────────────────────────────────

/**
 * Humaniza UM valor bruto preservando o conteúdo do lead.
 * Não interpreta renda, não classifica, não corrige semanticamente.
 */
export function humanizeAnswerValue(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  const lower = value.toLowerCase();
  if (lower === 'sim') return 'Sim';
  if (lower === 'nao' || lower === 'não') return 'Não';
  return value;
}

/**
 * Junta todos os valores de uma resposta em linguagem natural:
 * 1 valor → "A"; 2 → "A e B"; 3+ → "A, B e C".
 */
export function joinAnswerValues(values: string[]): string {
  const clean = values.map((v) => humanizeAnswerValue(v)).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} e ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} e ${clean[clean.length - 1]}`;
}

// ── Telefone ───────────────────────────────────────────────────

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/** Valida E.164 (usado também para decidir o botão de WhatsApp). */
export function isValidE164(phone: string | null | undefined): phone is string {
  return !!phone && E164_PATTERN.test(phone);
}

/**
 * Exibição amigável para números brasileiros (+55):
 * +5561999990000 → "(61) 99999-0000". Demais países mantêm o E.164.
 */
export function formatPhoneDisplay(e164: string): string {
  if (!e164.startsWith('+55')) return e164;
  const local = e164.slice(3);
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return e164;
}

/** Apenas dígitos (wa.me não aceita "+"). */
export function phoneDigits(e164: string): string {
  return e164.replace(/\D/g, '');
}

// ── Nomes ──────────────────────────────────────────────────────

/** Fallbacks técnicos que NUNCA são exibidos como nome de pessoa (§10.5). */
const TECHNICAL_NAME_PATTERN = /^lead\s*meta\s*ads(\s*\(.*\))?$/i;

export function isTechnicalLeadName(name: string | null | undefined): boolean {
  return !!name && TECHNICAL_NAME_PATTERN.test(name.trim());
}

/** Primeiro nome útil ("Mariana Alves" → "Mariana"); vazio se técnico/ausente. */
export function firstName(fullName: string | null | undefined): string {
  if (!fullName || isTechnicalLeadName(fullName)) return '';
  const first = fullName.trim().split(/\s+/)[0] || '';
  return isTechnicalLeadName(first) ? '' : first;
}

// ── Tempo ──────────────────────────────────────────────────────

const TIME_ZONE = 'America/Sao_Paulo';

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "06/09/2026 às 14:32" no fuso do CRM. */
export function formatDateTimeBr(date: Date): string {
  const parts = dateFmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || '';
  return `${get('day')}/${get('month')}/${get('year')} às ${get('hour')}:${get('minute')}`;
}

/**
 * Linha de tempo coerente do cartão (§15):
 * - enviado agora → "Enviado há poucos segundos • …"
 * - atraso curto  → "Enviado há X min/h • …"
 * - antigo        → "Cadastro enviado em …" (sem parecer recente)
 * - sem horário do Meta → "Recebido em …" (honesto, nunca inventa)
 */
export function formatLeadTiming(
  submittedAt: Date | null | undefined,
  receivedAt: Date,
): string {
  if (!submittedAt) return `Recebido em ${formatDateTimeBr(receivedAt)}`;

  const deltaMs = receivedAt.getTime() - submittedAt.getTime();
  const deltaMin = Math.floor(deltaMs / 60_000);
  const stamp = formatDateTimeBr(submittedAt);

  if (deltaMs < 0) {
    // Relógio de origem à frente: exibe só o horário declarado, sem "há"
    return `Cadastro enviado em ${stamp}`;
  }
  if (deltaMin < 2) return `Enviado há poucos segundos • ${stamp}`;
  if (deltaMin < 60) return `Enviado há ${deltaMin} min • ${stamp}`;
  const deltaHours = Math.floor(deltaMin / 60);
  if (deltaHours < 24) return `Enviado há ${deltaHours} h • ${stamp}`;
  return `Cadastro enviado em ${stamp}`;
}

// ── Mensagem inicial do WhatsApp (§14.2) ───────────────────────

/**
 * Rascunho curto e editável: só primeiro nome, sem dados sensíveis,
 * sem afirmar conversa anterior. O botão apenas abre o rascunho.
 */
export function buildWhatsAppGreeting(opts: {
  agentFirstName: string;
  leadFirstName: string;
  enterpriseName?: string | null;
}): string {
  const { agentFirstName, leadFirstName, enterpriseName } = opts;
  const lead = leadFirstName || '';
  const agent = agentFirstName || '';
  const aboutEnterprise = enterpriseName
    ? `, da equipe responsável por ${enterpriseName}`
    : '';
  const who = agent
    ? ` Sou ${agent}${aboutEnterprise}.`
    : aboutEnterprise
      ? ` Sou da equipe responsável por ${enterpriseName}.`
      : '';
  const contact = lead ? `Olá, ${lead}!${who}` : `Olá!${who}`;
  const intent = lead
    ? ' Recebi seu pedido de informações e estou à disposição. Podemos conversar por aqui?'
    : ' Recebi seu contato e estou à disposição. Podemos conversar por aqui?';
  return contact + intent;
}
