import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

async function canAccessClient(clientId: string, userId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const client = await db.client.findFirst({
    where: {
      id: clientId,
      OR: [
        { createdBy: userId },
        { partners: { some: { userId } } },
      ],
    },
    select: { id: true },
  });
  return !!client;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;

    // Verificar permissão de acesso ao cliente
    const currentUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const hasAccess = await canAccessClient(id, currentUser.id, currentUser.role === 'ADMIN');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso negado a este cliente' }, { status: 403 });
    }

    // Buscar dados completos do cliente
    const client = await db.client.findUnique({
      where: { id },
      include: {
        tags: { select: { tag: { select: { name: true, color: true } } } },
        partners: {
          select: { user: { select: { name: true } } },
        },
        creator: { select: { name: true } },
        linkedEnterprise: { select: { name: true } },
      },
    });

    if (!client) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
    }

    // Buscar interações, agendamentos e lembretes
    const [interactions, schedules, reminders] = await Promise.all([
      db.interaction.findMany({
        where: { clientId: id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { description: true, createdAt: true },
      }),
      db.schedule.findMany({
        where: { clientId: id },
        orderBy: { scheduledDate: 'desc' },
        take: 20,
        select: {
          scheduledDate: true,
          scheduledTime: true,
          description: true,
          status: true,
          completedAt: true,
          createdAt: true,
          creatorUser: { select: { name: true } },
        },
      }),
      db.reminder.findMany({
        where: { clientId: id },
        orderBy: { dueDate: 'desc' },
        take: 10,
        select: { title: true, description: true, dueDate: true, notified: true },
      }),
    ]);

    const STAGE_LABELS: Record<string, string> = {
      LEAD: 'Lead',
      PROSPECT: 'Prospect',
      VISITA_AGENDADA: 'Visita Agendada',
      VISITA_REALIZADA: 'Visita Realizada',
      CARTA_PROPOSTA: 'Carta Proposta',
      CONTRATO_GERADO: 'Contrato Gerado',
      FECHADO_GANHO: 'Fechado e Ganho',
      FECHADO_PERDIDO: 'Fechado e Perdido',
    };

    const stageLabel = STAGE_LABELS[client.stage] || client.stage;
    const tags = client.tags.map((t) => t.tag.name).join(', ') || 'Nenhuma';

    // Montar texto de contexto para a IA
    const parts: string[] = [];

    parts.push(`PERFIL DO CLIENTE:`);
    parts.push(`Nome: ${client.name}`);
    if (client.phone) parts.push(`Telefone: ${client.phone}`);
    if (client.email) parts.push(`E-mail: ${client.email}`);
    if (client.region) parts.push(`Região: ${client.region}`);
    if (client.enterprise) parts.push(`Empresa/Empreendimento: ${client.enterprise}`);
    if (client.linkedEnterprise) parts.push(`Empresa vinculada: ${client.linkedEnterprise.name}`);
    if (client.notes) parts.push(`Notas: ${client.notes}`);
    parts.push(`Estágio atual: ${stageLabel}`);
    parts.push(`Cadastrado em: ${new Date(client.createdAt).toLocaleDateString('pt-BR')}`);
    parts.push(`Última atualização: ${new Date(client.updatedAt).toLocaleDateString('pt-BR')}`);
    parts.push(`Criado por: ${client.creator?.name || 'N/A'}`);
    if (client.partners.length > 0) {
      parts.push(`Equipe: ${client.partners.map((p) => p.user.name).join(', ')}`);
    }
    parts.push(`Tags: ${tags}`);
    parts.push(`Período de atualização: ${client.updatePeriod} dias`);
    if (client.lastInteractionAt) {
      parts.push(`Última interação registrada: ${new Date(client.lastInteractionAt).toLocaleDateString('pt-BR')}`);
    }

    if (interactions.length > 0) {
      parts.push(`\nHISTORICO DE INTERAÇÕES (${interactions.length} total):`);
      interactions.slice(0, 15).forEach((i) => {
        const d = new Date(i.createdAt).toLocaleDateString('pt-BR');
        parts.push(`- [${d}] ${i.description}`);
      });
      if (interactions.length > 15) {
        parts.push(`(... e mais ${interactions.length - 15} interações)`);
      }
    }

    if (schedules.length > 0) {
      const statusLabels: Record<string, string> = {
        PENDING: 'Pendente',
        COMPLETED: 'Concluído',
        CANCELLED: 'Cancelado',
      };
      parts.push(`\nHISTORICO DE AGENDAMENTOS (${schedules.length} total):`);
      schedules.slice(0, 15).forEach((s) => {
        const d = new Date(s.scheduledDate).toLocaleDateString('pt-BR');
        const label = statusLabels[s.status] || s.status;
        const creator = s.creatorUser?.name || 'N/A';
        parts.push(
          `- [${d}] ${s.scheduledTime} — ${label} (por ${creator})${s.description ? ': ' + s.description : ''}`
        );
      });
      if (schedules.length > 15) {
        parts.push(`(... e mais ${schedules.length - 15} agendamentos)`);
      }

      // Resumo de agendamentos
      const completed = schedules.filter((s) => s.status === 'COMPLETED').length;
      const cancelled = schedules.filter((s) => s.status === 'CANCELLED').length;
      const pending = schedules.filter((s) => s.status === 'PENDING').length;
      parts.push(`\nResumo: ${completed} concluídos, ${cancelled} cancelados, ${pending} pendentes`);
    }

    if (reminders.length > 0) {
      parts.push(`\nLEMBRETES (${reminders.length} total):`);
      reminders.forEach((r) => {
        const d = new Date(r.dueDate).toLocaleDateString('pt-BR');
        const status = r.notified ? '(notificado)' : '(pendente)';
        parts.push(`- [${d}] ${r.title} ${status}${r.description ? ': ' + r.description : ''}`);
      });
    }

    const contextText = parts.join('\n');

    // Gerar o resumo com IA (Gemini ou Groq)
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    const aiPrompt = `Com base nos dados do cliente abaixo, gere um resumo de contexto inteligente e estratégico para preparar um profissional para o próximo atendimento.

O resumo deve conter EXATAMENTE estas seções, em português brasileiro, com formatação Markdown:

## Perfil Resumido
Um parágrafo conciso descrevendo quem é o cliente, qual seu perfil e contexto.

## Dados de Contato
Telefone, e-mail, região e empresa (se houver). Formato de lista.

## Pipeline e Andamento
Onde o cliente está no funil de vendas, há quanto tempo, e o que já aconteceu no processo.

## Histórico Recente
Resumo das últimas interações e agendamentos mais relevantes. Foque no que é importante para a próxima visita.

## Observações e Pendências
Pendências, padrões de comportamento, preferências anotadas ou reclamações anteriores.

## Sugestões para o Próximo Atendimento
Com base em todo o histórico, sugira 2-3 pontos específicos para abordar na próxima interação com este cliente. Seja prático e direto.

Regras:
- Use formatação Markdown (negrito, listas, cabeçalhos com ##).
- Seja objetivo e prático.
- NÃO invente informações que não estejam nos dados.
- Se não houver dados suficientes para alguma seção, escreva "Nenhum dado disponível" com naturalidade.
- Use linguagem profissional mas acessível.
- Mantenha o resumo conciso mas completo.`;

    let summary = '';

    if (GEMINI_API_KEY) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: aiPrompt }],
              },
              contents: [
                {
                  role: 'user',
                  parts: [{ text: contextText }],
                },
              ],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 2048,
              },
            }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          summary =
            data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }
      } catch (err) {
        console.error('[Context Memory] Erro Gemini:', err);
      }
    }

    // Fallback para Groq
    if (!summary && GROQ_API_KEY) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
              { role: 'system', content: aiPrompt },
              { role: 'user', content: contextText },
            ],
            temperature: 0.3,
            max_tokens: 2048,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          summary =
            data?.choices?.[0]?.message?.content || '';
        }
      } catch (err) {
        console.error('[Context Memory] Erro Groq:', err);
      }
    }

    return NextResponse.json({
      summary,
      clientName: client.name,
      stage: client.stage,
      stageLabel,
      totalInteractions: interactions.length,
      totalSchedules: schedules.length,
      completedSchedules: schedules.filter((s) => s.status === 'COMPLETED').length,
      hasPhone: !!client.phone,
      hasEmail: !!client.email,
      tags,
      enterprise: client.enterprise || client.linkedEnterprise?.name || null,
      region: client.region || null,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
      lastInteractionAt: client.lastInteractionAt,
    });
  } catch (error) {
    console.error('Erro ao gerar memória de contexto:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}