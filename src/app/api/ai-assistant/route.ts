import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

// --- Provedores de IA ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.1-8b-instant';

// --- Prompt do sistema ---
const SYSTEM_PROMPT = `Você é o assistente virtual do CRM Pro, um sistema brasileiro de gestão de relacionamento com clientes. Seu papel é ajudar o usuário a:

1. **Encontrar clientes** — busque nos dados fornecidos por nome, região, empresa, estágio, tags ou qualquer critério.
2. **Ver agendamentos** — informe sobre visitas agendadas, passadas ou futuras.
3. **Lembretes** — mostre lembretes pendentes ou próximos.
4. **Explicar funcionalidades** — explique como usar o CRM de forma clara e detalhada.

O funil de vendas do CRM Pro possui EXATAMENTE estas 8 etapas nesta ordem:
1. **LEAD** (Lead) — primeiro contato, cliente em potencial identificado
2. **PROSPECT** (Prospect) — cliente demonstrou interesse, está sendo qualificado
3. **VISITA_AGENDADA** (Visita Agendada) — visita comercial agendada
4. **VISITA_REALIZADA** (Visita Realizada) — visita comercial já realizada
5. **CARTA_PROPOSTA** (Carta Proposta) — proposta comercial enviada ao cliente
6. **CONTRATO_GERADO** (Contrato Gerado) — contrato gerado e enviado
7. **FECHADO_GANHO** (Fechado e Ganho) — negócio fechado com sucesso
8. **FECHADO_PERDIDO** (Fechado e Perdido) — negócio perdido

Funcionalidades do CRM:
- **Dashboard**: visão geral com KPIs (total de clientes, visitas de hoje, próximos agendamentos, histórico)
- **Clientes**: cadastro completo com funil de 8 etapas, tags, interações, agendamentos de visita, notas e parcerias entre usuários
- **Negócios Finalizados**: lista de clientes que chegaram a "Fechado e Ganho" ou "Fechado e Perdido"
- **Tags**: categorização de clientes com etiquetas coloridas para filtro rápido
- **Lembretes**: lembretes vinculados a clientes com data e descrição
- **Agendamentos de Visita**: visitas agendadas vinculadas a um cliente específico. Cada agendamento possui data, horário, descrição (opcional) e status (PENDENTE, CONCLUIDO, CANCELADO).
  - **Como criar um agendamento**: os agendamentos são criados DENTRO da ficha de um cliente — não existe uma tela separada para isso. O fluxo é: 1) abra a lista de clientes; 2) clique no cliente desejado para abrir o painel de detalhes; 3) role até a seção "Agendamentos"; 4) clique no botão "Agendar Visita"; 5) preencha a data (obrigatória, pelo seletor de calendário — datas passadas ficam desabilitadas), o horário (obrigatório, formato HH:mm, padrão 10:00) e as observações (opcional, texto livre); 6) clique em "Agendar". A visita é criada com status PENDENTE e a equipe (criador + parceiros do cliente) recebe notificação por e-mail e WhatsApp automaticamente.
  - **Integração com Google Calendar**: quando o Google Calendar está conectado (em Configurações > Google Calendar), cada agendamento criado no CRM gera automaticamente um evento no Google Calendar do usuário. O evento tem duração de 1 hora e inclui 4 lembretes automáticos: notificação popup 24 horas antes, notificação popup 2 horas antes, e-mail 24 horas antes e e-mail 2 horas antes. O título do evento inclui o nome do cliente. Se o agendamento for cancelado, o título do evento no Google Calendar é atualizado com o prefixo "[CANCELADA]"; se for confirmado como realizado, recebe o prefixo "[REALIZADA]". Se o agendamento for excluído permanentemente, o evento também é removido do Google Calendar. Tudo isso acontece de forma automática e transparente — o usuário não precisa fazer nada além de conectar o Google Calendar nas configurações. Se a integração falhar por qualquer motivo (por exemplo, token expirado ou sem conexão), o agendamento continua funcionando normalmente no CRM sem nenhum impacto.
  - **Após a criação**: o agendamento aparece no Dashboard (seções "Visitas de Hoje", "Próximas Visitas" e "Histórico"), na ficha do cliente e, se o Google Calendar estiver conectado, também no Google Calendar do usuário. Se a data já passou e ainda está PENDENTE, aparece como "Atrasada" em vermelho.
  - **Ações sobre agendamentos pendentes**: confirmar visita (muda para CONCLUIDO), cancelar (muda para CANCELADO) ou excluir permanentemente. Apenas agendamentos com status PENDENTE podem ser confirmados ou cancelados. A exclusão está disponível para qualquer status. Todas essas ações também refletem no Google Calendar quando a integração está ativa.
  - **Como conectar o Google Calendar**: vá em Configurações > Google Calendar e clique "Conectar". Será aberta a tela de autorização do Google — basta permitir o acesso. Para funcionar, as variáveis de ambiente GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET precisam estar configuradas no painel da Vercel. Se houver erro 403 ao conectar, verifique no Google Cloud Console se o email do usuário está adicionado como "Usuário de teste" na Tela de consentimento OAuth.
- **Administração** (somente admin): gerenciamento de usuários e configurações do sistema
- **Configurações**: preferências do usuário e gestão de empreendimentos (importação em lote via Excel)
- **Bases de Dados de Empreendimentos**: o administrador pode enviar arquivos (PDF, Markdown ou texto) com informações detalhadas de cada empreendimento (plantas, valores, metragens, condições de pagamento, etc.). Quando um usuário pergunta sobre um empreendimento específico, você recebe o conteúdo extraído desse arquivo como contexto. Cada empreendimento tem sua base de dados individual e separada — nunca misture informações de empreendimentos diferentes.
- **Parcerias**: usuários podem compartilhar acesso a clientes vinculando-se como parceiros

Regras:
- Responda SEMPRE em português brasileiro.
- Seja objetivo e direto. Use listas quando apropriado.
- Quando apresentar clientes, inclua: nome, região, estágio (use o nome legível), empresa (se houver) e telefone (se houver).
- Quando apresentar agendamentos, inclua: data, horário, cliente e status.
- Nunca invente dados que não estejam no contexto.
- Quando explicar o funil, use SEMPRE as 8 etapas listadas acima. Nunca invente etapas como "NEGOTIATING" ou "WON" — os nomes corretos são FECHADO_GANHO, FECHADO_PERDIDO, etc.
- Quando a pergunta mencionar um empreendimento específico e houver uma seção "BASE DE DADOS DO EMPREENDIMENTO" no contexto, use APENAS aquelas informações para responder sobre esse empreendimento. Nunca invente dados que não estejam na base.
- Se a pergunta for sobre um empreendimento e não houver base de dados disponível no contexto, informe que não há informações detalhadas cadastradas para esse empreendimento e sugira que o administrador envie o arquivo com os dados.
- Use formatação Markdown (negrito, listas).`;

// --- Tipos ---
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

type ProviderResult = { reply: string; provider: string };

// --- Busca de dados do CRM ---
async function fetchUserData(userId: string, userRole: string) {
  const isAdmin = userRole === 'ADMIN';
  const userFilter = isAdmin ? {} : {
    OR: [{ createdBy: userId }, { partners: { some: { userId } } }],
  };

  const [clients, schedules, reminders] = await Promise.all([
    db.client.findMany({
      where: userFilter,
      select: {
        name: true, phone: true, email: true, region: true,
        enterprise: true, stage: true,
        tags: { select: { tag: { select: { name: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    }),
    db.schedule.findMany({
      where: {
        scheduledDate: {
          gte: new Date(Date.now() - 30 * 86400000),
          lte: new Date(Date.now() + 30 * 86400000),
        },
        ...(!isAdmin ? userFilter : {}),
      },
      select: {
        scheduledDate: true, scheduledTime: true,
        description: true, status: true,
        client: { select: { name: true } },
        creatorUser: { select: { name: true } },
      },
      orderBy: { scheduledDate: 'asc' },
      take: 40,
    }),
    db.reminder.findMany({
      where: {
        notified: false,
        ...(!isAdmin ? { client: { createdBy: userId } } : {}),
      },
      select: {
        title: true, dueDate: true,
        client: { select: { name: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 20,
    }),
  ]);

  return { clients, schedules, reminders };
}

// --- Base de dados de empreendimentos ---
const MAX_ENTERPRISE_CONTEXT_CHARS = 30000; // Gemini suporta 1M tokens — folga total

async function fetchEnterpriseContent(userMessage: string): Promise<string> {
  try {
    const enterprises = await db.enterprise.findMany({
      where: { pdfContent: { not: null } },
      select: { id: true, name: true, pdfContent: true },
    });

    if (enterprises.length === 0) return '';

    const normalize = (s: string) => s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .trim();

    const normalizedMessage = normalize(userMessage);

    // Buscar o empreendimento mais relevante mencionado na mensagem
    let matched = enterprises.find(e => {
      const normalizedName = normalize(e.name);
      return normalizedMessage.includes(normalizedName);
    });

    if (!matched) {
      const scores = enterprises.map(e => {
        const nameParts = normalize(e.name).split(/\s+/).filter(p => p.length >= 4);
        const matchCount = nameParts.filter(p => normalizedMessage.includes(p)).length;
        return { enterprise: e, score: matchCount / nameParts.length };
      });
      scores.sort((a, b) => b.score - a.score);
      if (scores[0] && scores[0].score >= 0.5) {
        matched = scores[0].enterprise;
      }
    }

    if (!matched || !matched.pdfContent) return '';

    let content = matched.pdfContent;
    if (content.length > MAX_ENTERPRISE_CONTEXT_CHARS) {
      let cutIndex = content.lastIndexOf('\n', MAX_ENTERPRISE_CONTEXT_CHARS);
      if (cutIndex < MAX_ENTERPRISE_CONTEXT_CHARS * 0.5) cutIndex = MAX_ENTERPRISE_CONTEXT_CHARS;
      content = content.slice(0, cutIndex) + '\n\n[...] Conteúdo truncado. O arquivo contém mais informações do que foi possível incluir aqui.';
    }

    return `=== BASE DE DADOS DO EMPREENDIMENTO: ${matched.name.toUpperCase()} ===\n${content}`;
  } catch (err) {
    console.error('[AI ASSISTANT] Erro ao buscar base de dados do empreendimento:', err);
    return '';
  }
}

// --- Formatar dados do CRM como texto ---
function formatDataForContext(data: Awaited<ReturnType<typeof fetchUserData>>): string {
  const parts: string[] = [];

  parts.push('=== CLIENTES ===');
  if (data.clients.length === 0) {
    parts.push('Nenhum cliente cadastrado.');
  } else {
    data.clients.forEach(c => {
      const tags = c.tags.map(t => t.tag.name).join(', ') || '-';
      parts.push(`- ${c.name} | Região: ${c.region || '-'} | Estágio: ${c.stage} | Empresa: ${c.enterprise || '-'} | Tel: ${c.phone || '-'} | Email: ${c.email || '-'} | Tags: ${tags}`);
    });
  }

  parts.push('\n=== AGENDAMENTOS ===');
  if (data.schedules.length === 0) {
    parts.push('Nenhum agendamento no período.');
  } else {
    data.schedules.forEach(s => {
      const d = new Date(s.scheduledDate).toLocaleDateString('pt-BR');
      parts.push(`- ${d} ${s.scheduledTime} | ${s.client.name} | ${s.status} | Por: ${s.creatorUser.name}${s.description ? ' | ' + s.description : ''}`);
    });
  }

  parts.push('\n=== LEMBRETES PENDENTES ===');
  if (data.reminders.length === 0) {
    parts.push('Nenhum lembrete pendente.');
  } else {
    data.reminders.forEach(r => {
      const d = new Date(r.dueDate).toLocaleDateString('pt-BR');
      parts.push(`- ${d} | ${r.title} | ${r.client.name}`);
    });
  }

  return parts.join('\n');
}

// --- Montar system text completo (sem truncar — Gemini suporta 1M tokens) ---
function buildFullSystemText(dataContext: string, enterpriseContext: string): string {
  let systemText = `${SYSTEM_PROMPT}\n\n---\nDADOS DO CRM:\n${dataContext}`;
  if (enterpriseContext) {
    systemText += `\n\n---\n${enterpriseContext}`;
  }
  return systemText;
}

// --- Montar system text reduzido para Groq fallback (limite 6000 TPM) ---
function buildGroqSystemText(dataContext: string, enterpriseContext: string): string {
  // Groq free tier: 6000 TPM. Português com markdown ≈ 3 chars/token.
  // System prompt ~3500 chars (~1100 tokens). Mensagens (4) ~500 tokens.
  // Reserve 1024 tokens para resposta. Disponível: 6000-1100-500-1024 = 3376 tokens ≈ 10000 chars.
  const MAX_GROQ_TOTAL = 10000;

  // Primeiro, truncar o dataContext se necessário
  let trimmedData = dataContext;
  const baseLen = SYSTEM_PROMPT.length + 30; // +30 para "\n\n---\nDADOS DO CRM:\n"
  const maxDataLen = MAX_GROQ_TOTAL - baseLen - 400; // 400 de margem para enterprise header
  if (trimmedData.length > maxDataLen) {
    // Cortar por linhas
    const lines = trimmedData.split('\n');
    let totalLen = 0;
    const keptLines: string[] = [];
    for (const line of lines) {
      if (totalLen + line.length + 1 > maxDataLen) break;
      keptLines.push(line);
      totalLen += line.length + 1;
    }
    trimmedData = keptLines.join('\n') + '\n[...] Dados truncados pelo limite de tokens do provedor fallback.';
  }

  let systemText = `${SYSTEM_PROMPT}\n\n---\nDADOS DO CRM:\n${trimmedData}`;

  // Calcular espaço restante para a base de dados da empresa
  const remaining = MAX_GROQ_TOTAL - systemText.length - 100;
  if (enterpriseContext && remaining > 150) {
    if (enterpriseContext.length <= remaining) {
      systemText += `\n\n---\n${enterpriseContext}`;
    } else {
      let cutIndex = enterpriseContext.lastIndexOf('\n', remaining);
      if (cutIndex < remaining * 0.5) cutIndex = remaining;
      systemText += `\n\n---\n${enterpriseContext.slice(0, cutIndex)}\n\n[...] Conteúdo truncado pelo limite de tokens do provedor fallback.`;
    }
  } else if (enterpriseContext) {
    console.log('[AI ASSISTANT] Contexto da empresa omitido no fallback por limite de tokens');
  }

  return systemText;
}

// --- Provedor: Google Gemini (primário) ---
async function askGemini(systemText: string, messages: Message[]): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY não configurada');
  }

  // Converter mensagens para formato Gemini ("assistant" → "model")
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text
    || 'Desculpe, não consegui gerar uma resposta.';
}

// --- Provedor: Groq (fallback) ---
async function askGroq(systemText: string, messages: Message[]): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY não configurada');
  }

  const url = 'https://api.groq.com/openai/v1/chat/completions';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.3,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemText },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'Desculpe, não consegui gerar uma resposta.';
}

// --- Chamada principal com fallback automático ---
async function askAI(dataContext: string, enterpriseContext: string, messages: Message[]): Promise<ProviderResult> {
  // 1) Tentar Gemini primeiro (1M tokens, 1500 req/dia grátis)
  if (GEMINI_API_KEY) {
    try {
      const fullSystemText = buildFullSystemText(dataContext, enterpriseContext);
      const reply = await askGemini(fullSystemText, messages);
      return { reply, provider: 'Gemini' };
    } catch (err) {
      console.warn('[AI ASSISTANT] Gemini falhou, tentando Groq como fallback:', err instanceof Error ? err.message : err);
    }
  } else {
    console.log('[AI ASSISTANT] GEMINI_API_KEY não configurada, usando Groq diretamente');
  }

  // 2) Fallback para Groq — construir system text com limites estritos (6000 TPM)
  if (GROQ_API_KEY) {
    const groqSystemText = buildGroqSystemText(dataContext, enterpriseContext);
    const groqMessages = messages.slice(-4); // Menos histórico para economizar tokens
    const reply = await askGroq(groqSystemText, groqMessages);
    return { reply, provider: 'Groq (fallback)' };
  }

  throw new Error('Nenhum provedor de IA disponível. Configure GEMINI_API_KEY ou GROQ_API_KEY.');
}

// --- Handler principal ---
export async function POST(req: NextRequest) {
  let dbError = false;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await req.json();
    const { messages } = body as { messages: Message[] };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Mensagens inválidas' }, { status: 400 });
    }

    // Buscar dados do CRM
    let dataContext = '(Dados indisponíveis no momento)';
    let enterpriseContext = '';
    try {
      const userId = session.user.id;
      const userRole = (session.user as { role?: string })?.role || 'USER';
      const data = await fetchUserData(userId, userRole);
      dataContext = formatDataForContext(data);
    } catch (err) {
      dbError = true;
      console.error('[AI ASSISTANT] DB fetch failed, continuing without data:', err);
    }

    // Buscar base de dados de empreendimento se a pergunta mencionar um
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    try {
      enterpriseContext = await fetchEnterpriseContent(lastUserMessage);
    } catch (err) {
      console.error('[AI ASSISTANT] Enterprise content fetch failed:', err);
    }

    // Enviar para IA com fallback automático
    const { reply, provider } = await askAI(dataContext, enterpriseContext, messages);
    console.log(`[AI ASSISTANT] Resposta gerada via ${provider}`);

    const finalReply = dbError
      ? reply + '\n\n⚠️ *Nota: Não foi possível acessar os dados do CRM neste momento.*'
      : reply;

    return NextResponse.json({ reply: finalReply });
  } catch (error) {
    console.error('[AI ASSISTANT] Error:', error);
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json(
      { error: `Erro ao processar: ${msg}` },
      { status: 500 }
    );
  }
}