/**
 * Constrói o modelo de apresentação do cartão a partir do contrato de
 * entrada e do empreendimento resolvido. Função PURA — sem rede, sem DB.
 *
 * Ordem visual reflete a tarefa do atendente (§11):
 *   evento/atribuição → empreendimento → pessoa → respostas → origem → tempo → ações.
 */

import {
  type HumanizedAnswer,
  type LeadPresentationContact,
  type LeadSourceSummary,
  type RawLeadAnswer,
  type ResolvedEnterprise,
  type TelegramLeadEventKind,
  type TelegramLeadNotificationInput,
  type TelegramLeadPresentation,
} from './types';
import {
  buildWhatsAppGreeting,
  firstName,
  formatPhoneDisplay,
  humanizeAnswerLabel,
  isValidE164,
  isTechnicalLeadName,
  joinAnswerValues,
  phoneDigits,
} from './humanize';

/** Limite por resposta antes de exibir "… (continua no CRM)". */
export const MAX_ANSWER_VALUE_LENGTH = 900;

const CRM_BASE = (process.env.NEXTAUTH_URL || '').replace(/\/+$/, '');

const EVENT_TITLES: Record<TelegramLeadEventKind, string> = {
  new_lead: 'Novo interesse para você',
  returning_lead: 'Novo interesse de um contato existente',
  recovered_lead: 'Contato recuperado e atribuído',
  imported_lead: 'Contato importado e atribuído',
  test: 'Prévia de notificação — dados fictícios',
};

const CHANNEL_LABELS: Record<string, string> = {
  webhook: 'Meta Ads',
  polling: 'Meta Ads',
  import_by_form: 'Meta Ads · importação por formulário',
  manual: 'Meta Ads · importação manual',
  simulation: 'Meta Ads · simulação',
  landing: 'Landing page',
  recovery: 'Recuperação de lead',
  test: 'Prévia',
};

function buildIntro(
  eventKind: TelegramLeadEventKind,
  agentFirst: string,
  leadFirst: string,
  enterpriseName?: string,
): string {
  const agent = agentFirst ? `${agentFirst}, ` : '';
  const subject = leadFirst || 'um novo contato';
  const about = enterpriseName ? ` sobre ${enterpriseName}` : ' pelo anúncio';

  switch (eventKind) {
    case 'new_lead':
      return `${agent}${subject} acabou de pedir informações${about}. Este atendimento está com você.`;
    case 'returning_lead':
      return `${agent}${subject} já é contato aqui no CRM e enviou um novo formulário${about}. Este atendimento está com você.`;
    case 'recovered_lead':
      return `${agent}o contato sobre ${enterpriseName || 'um empreendimento'} foi recuperado e atribuído a você.`;
    case 'imported_lead':
      return `${agent}o contato sobre ${enterpriseName || 'um empreendimento'} foi importado e atribuído a você.`;
    case 'test':
      return `${agent}isto é uma prévia do cartão que você recebe quando um lead chega. Nenhum lead real foi criado.`;
  }
}

function buildContact(input: TelegramLeadNotificationInput): LeadPresentationContact {
  const rawName = input.leadName?.trim() || '';
  const name = rawName && !isTechnicalLeadName(rawName) ? rawName : undefined;
  const phoneE164 = isValidE164(input.leadPhoneE164) ? input.leadPhoneE164 : undefined;
  const email = input.leadEmail?.trim() || undefined;
  const region = input.leadRegion?.trim() || undefined;

  return {
    name,
    phoneE164,
    phoneDisplay: phoneE164 ? formatPhoneDisplay(phoneE164) : undefined,
    email,
    region,
    hasAny: Boolean(name || phoneE164 || email || region),
  };
}

function buildAnswers(rawAnswers: RawLeadAnswer[], limitations: string[]): HumanizedAnswer[] {
  const answers: HumanizedAnswer[] = [];
  let order = 0;

  for (const raw of rawAnswers) {
    const displayValue = joinAnswerValues(raw.values ?? []);
    if (!displayValue) continue; // campo vazio nunca é exibido (§10.5)

    const answer: HumanizedAnswer = {
      key: raw.key,
      label: humanizeAnswerLabel(raw.key),
      displayValue,
      order: order++,
    };

    if (displayValue.length > MAX_ANSWER_VALUE_LENGTH) {
      const cutAt = displayValue.lastIndexOf(' ', MAX_ANSWER_VALUE_LENGTH);
      const cut = cutAt > 0 ? cutAt : MAX_ANSWER_VALUE_LENGTH;
      answer.displayValue = `${displayValue.slice(0, cut)}… (continua no CRM)`;
      answer.truncated = true;
      limitations.push(`answer_truncated:${raw.key}`);
    }

    answers.push(answer);
  }

  return answers;
}

function buildSourceSummary(input: TelegramLeadNotificationInput): LeadSourceSummary {
  const { source } = input;
  return {
    channelLabel: CHANNEL_LABELS[source.ingestionMethod] || 'Meta Ads',
    campaign: source.campaignName?.trim() || undefined,
    ad: source.adName?.trim() || undefined,
    form: source.formName?.trim() || undefined,
  };
}

/**
 * Monta a apresentação completa. `resolved` pode ser null (sem vínculo) —
 * nesse caso a mensagem usa texto neutro, sem inventar empreendimento.
 */
export function buildLeadPresentation(
  input: TelegramLeadNotificationInput,
  resolved: ResolvedEnterprise | null,
): TelegramLeadPresentation {
  const limitations: string[] = [];
  const contact = buildContact(input);
  const answers = buildAnswers(input.rawAnswers, limitations);
  const agentFirst = firstName(input.recipientFirstName) || 'atendimento';

  const enterprise =
    resolved && resolved.name
      ? {
          id: resolved.enterpriseId,
          name: resolved.name,
          imageUrl: resolved.imageUrl,
          imageAlt: resolved.imageAlt || resolved.name,
        }
      : null;

  const leadFirst = firstName(input.leadName);
  const intro = buildIntro(
    input.eventKind,
    agentFirst,
    leadFirst,
    enterprise?.name,
  );

  const crmUrl = input.clientId && CRM_BASE ? `${CRM_BASE}/` : undefined;

  const greeting =
    contact.phoneE164 || contact.name
      ? buildWhatsAppGreeting({
          agentFirstName: agentFirst === 'atendimento' ? '' : agentFirst,
          leadFirstName: leadFirst,
          enterpriseName: enterprise?.name,
        })
      : undefined;

  const whatsappUrl = contact.phoneE164
    ? `https://wa.me/${phoneDigits(contact.phoneE164)}${
        greeting ? `?text=${encodeURIComponent(greeting)}` : ''
      }`
    : undefined;

  const presentation: TelegramLeadPresentation = {
    title: EVENT_TITLES[input.eventKind],
    intro,
    eventLabel: input.eventKind,
    contact,
    enterprise,
    answers,
    sourceSummary: buildSourceSummary(input),
    submittedAt: input.source.submittedAt || undefined,
    receivedAt: input.source.receivedAt,
    crmUrl,
    whatsappUrl,
    whatsappGreeting: greeting,
    limitations,
  };

  return presentation;
}
