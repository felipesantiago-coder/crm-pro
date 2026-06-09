import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.1-8b-instant';

const SYSTEM_PROMPT = `Você é o assistente virtual do CRM Pro, um sistema brasileiro de gestão de relacionamento com clientes. Seu papel é ajudar o usuário a:

1. **Encontrar clientes** — busque nos dados fornecidos por nome, região, empresa, estágio (LEAD, PROSPECT, NEGOTIATING, WON, LOST), tags ou qualquer critério.
2. **Ver agendamentos** — informe sobre visitas agendadas, passadas ou futuras.
3. **Lembretes** — mostre lembretes pendentes ou próximos.
4. **Explicar funcionalidades** — explique como usar o CRM de forma clara.

Regras:
- Responda SEMPRE em português brasileiro.
- Seja objetivo e direto. Use listas quando apropriado.
- Quando apresentar clientes, inclua: nome, região, estágio, empresa (se houver) e telefone (se houver).
- Quando apresentar agendamentos, inclua: data, horário, cliente e status.
- Nunca invente dados que não estejam no contexto.
- Para perguntas sobre como usar o CRM, responda com base no seu conhecimento das funcionalidades: Dashboard, Clientes, Negócios Finalizados, Tags, Lembretes, Agendamentos, Administração e Configurações.
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