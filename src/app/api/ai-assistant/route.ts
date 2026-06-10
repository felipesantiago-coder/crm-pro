import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.1-8b-instant';

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
- **Parcerias**: usuários podem compartilhar acesso a clientes vinculando-se como parceiros

Regras:
- Responda SEMPRE em português brasileiro.
- Seja objetivo e direto. Use listas quando apropriado.
- Quando apresentar clientes, inclua: nome, região, estágio (use o nome legível), empresa (se houver) e telefone (se houver).
- Quando apresentar agendamentos, inclua: data, horário, cliente e status.
- Nunca invente dados que não estejam no contexto.
- Quando explicar o funil, use SEMPRE as 8 etapas listadas acima. Nunca invente etapas como "NEGOTIATING" ou "WON" — os nomes corretos são FECHADO_GANHO, FECHADO_PERDIDO, etc.
- Use formatação Markdown (negrito, listas).`;

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

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

async function askGroq(systemText: string, messages: Message[]): Promise<string> {
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  const body = {
    model: GROQ_MODEL,
    temperature: 0.3,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemText },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'Desculpe, não consegui gerar uma resposta.';
}

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

    // Fetch user data — if DB fails, continue without data context
    let dataContext = '(Dados indisponíveis no momento)';
    try {
      const userId = session.user.id;
      const userRole = (session.user as { role?: string })?.role || 'USER';
      const data = await fetchUserData(userId, userRole);
      dataContext = formatDataForContext(data);
    } catch (err) {
      dbError = true;
      console.error('[AI ASSISTANT] DB fetch failed, continuing without data:', err);
    }

    const systemText = `${SYSTEM_PROMPT}\n\n---\nDADOS DO CRM:\n${dataContext}`;
    const reply = await askGroq(systemText, messages.slice(-8));

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