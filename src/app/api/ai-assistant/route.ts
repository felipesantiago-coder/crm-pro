import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { ensureDbConnection } from '@/lib/db';
import ZAI from 'z-ai-web-dev-sdk';

const SYSTEM_PROMPT = `Você é o assistente virtual do CRM Pro, um sistema brasileiro de gestão de relacionamento com clientes. Seu papel é ajudar o usuário a:

1. **Encontrar clientes** — busque nos dados fornecidos por nome, região, empresa, estágio (LEAD, PROSPECT, NEGOTIATING, WON, LOST), tags ou qualquer critério mencionado.
2. **Ver agendamentos** — informe sobre visitas agendadas, passadas ou futuras.
3. **Lembretes** — mostre lembretes pendentes ou próximos.
4. **Explicar funcionalidades** — se o usuário perguntar como fazer algo no CRM, explique de forma clara e direta.

Regras:
- Responda SEMPRE em português brasileiro.
- Seja objetivo e direto. Use listas quando apropriado.
- Quando apresentar dados de clientes, inclua: nome, região, estágio, empresa (se houver) e telefone (se houver).
- Quando apresentar agendamentos, inclua: data, horário, cliente e status.
- Se os dados fornecidos não contiverem informação suficiente, diga que não encontrou e sugira outros termos de busca.
- Nunca invente dados que não estejam no contexto fornecido.
- Para perguntas sobre como usar o CRM, responda com base no seu conhecimento das funcionalidades: Dashboard, Clientes, Negócios Finalizados, Tags, Lembretes, Agendamentos, Administração e Configurações.
- Use formatação Markdown para organizar melhor as respostas (negrito, listas, etc.).`;

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

async function fetchUserData(userId: string, userRole: string) {
  const client = await ensureDbConnection(3);

  const clients = await client.client.findMany({
    where: userRole === 'ADMIN' ? {} : { OR: [{ createdBy: userId }, { partners: { some: { userId } } }] },
    select: {
      id: true, name: true, phone: true, email: true, region: true,
      enterprise: true, stage: true, updatedAt: true,
      tags: { select: { tag: { select: { name: true, color: true } } } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysLater = new Date(today);
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

  const schedules = await client.schedule.findMany({
    where: {
      scheduledDate: { gte: thirtyDaysAgo, lte: thirtyDaysLater },
      ...(userRole !== 'ADMIN' ? { OR: [{ createdBy: userId }, { client: { partners: { some: { userId } } } }] } : {}),
    },
    select: {
      id: true, scheduledDate: true, scheduledTime: true,
      description: true, status: true,
      client: { select: { name: true } },
      creatorUser: { select: { name: true } },
    },
    orderBy: { scheduledDate: 'asc' },
    take: 50,
  });

  const reminders = await client.reminder.findMany({
    where: {
      notified: false,
      ...(userRole !== 'ADMIN' ? { client: { createdBy: userId } } : {}),
    },
    select: {
      id: true, title: true, description: true, dueDate: true,
      client: { select: { name: true } },
    },
    orderBy: { dueDate: 'asc' },
    take: 30,
  });

  return { clients, schedules, reminders };
}

function formatDataForContext(data: Awaited<ReturnType<typeof fetchUserData>>): string {
  const lines: string[] = [];

  lines.push('=== CLIENTES ===');
  if (data.clients.length === 0) {
    lines.push('Nenhum cliente encontrado.');
  } else {
    data.clients.forEach(c => {
      const tags = c.tags.map(t => t.tag.name).join(', ') || 'nenhuma';
      lines.push(`- ${c.name} | Região: ${c.region || 'N/A'} | Estágio: ${c.stage} | Empresa: ${c.enterprise || 'N/A'} | Tel: ${c.phone || 'N/A'} | Email: ${c.email || 'N/A'} | Tags: ${tags}`);
    });
  }

  lines.push('');
  lines.push('=== AGENDAMENTOS (últimos 30 dias e próximos 30 dias) ===');
  if (data.schedules.length === 0) {
    lines.push('Nenhum agendamento encontrado.');
  } else {
    data.schedules.forEach(s => {
      const dateStr = new Date(s.scheduledDate).toLocaleDateString('pt-BR');
      lines.push(`- ${dateStr} às ${s.scheduledTime} | Cliente: ${s.client.name} | Status: ${s.status} | Criado por: ${s.creatorUser.name}${s.description ? ` | Descrição: ${s.description}` : ''}`);
    });
  }

  lines.push('');
  lines.push('=== LEMBRETES PENDENTES ===');
  if (data.reminders.length === 0) {
    lines.push('Nenhum lembrete pendente.');
  } else {
    data.reminders.forEach(r => {
      const dateStr = new Date(r.dueDate).toLocaleDateString('pt-BR');
      lines.push(`- ${dateStr} | ${r.title} | Cliente: ${r.client.name}${r.description ? ` | ${r.description}` : ''}`);
    });
  }

  return lines.join('\n');
}

export async function POST(req: NextRequest) {
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

    // Fetch user data for context
    const userId = session.user.id;
    const userRole = (session.user as { role?: string })?.role || 'USER';

    const data = await fetchUserData(userId, userRole);
    const dataContext = formatDataForContext(data);

    const contextMessage: Message = {
      role: 'system',
      content: `${SYSTEM_PROMPT}\n\n---\nDADOS ATUAIS DO CRM DO USUÁRIO:\n${dataContext}`,
    };

    // Build conversation: system context + history + new message
    const conversation: Message[] = [
      contextMessage,
      ...messages.slice(-10), // Keep last 10 messages for context window
    ];

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: conversation,
      temperature: 0.3,
    });

    const reply = completion.choices?.[0]?.message?.content || 'Desculpe, não consegui gerar uma resposta.';

    return NextResponse.json({ reply });
  } catch (error) {
    console.error('[AI ASSISTANT] Error:', error);
    return NextResponse.json(
      { error: 'Erro ao processar sua mensagem. Tente novamente.' },
      { status: 500 }
    );
  }
}