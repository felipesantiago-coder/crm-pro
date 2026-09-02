import { db } from '@/lib/db';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  notifyScheduleCreated,
  notifyReminderDue,
  notifyPartnerAdded,
  notifyInteractionAdded,
  notifyScheduleUpcoming,
} from './email';
import {
  sendWhatsApp,
  sendWhatsAppScheduleCreated,
  sendWhatsAppReminderDue,
  sendWhatsAppPartnerAdded,
  sendWhatsAppInteractionAdded,
  sendWhatsAppScheduleUpcoming,
} from './whatsapp';

// ──── Helpers para buscar destinatários ──────────────────────────

interface Recipient {
  email: string;
  name: string;
  phone?: string | null;
}

async function getClientTeam(clientId: string): Promise<Recipient[]> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    include: {
      creator: { select: { id: true, name: true, email: true } },
      partners: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!client) return [];

  const recipients: Recipient[] = [];

  // Criador
  if (client.creator) {
    recipients.push({ email: client.creator.email, name: client.creator.name });
  }

  // Parceiros
  for (const p of client.partners) {
    recipients.push({ email: p.user.email, name: p.user.name });
  }

  return recipients;
}

async function getCreatorAndPartners(clientId: string, excludeUserId?: string): Promise<Recipient[]> {
  const team = await getClientTeam(clientId);
  if (excludeUserId) {
    return team.filter((r) => r.email !== excludeUserId);
  }
  return team;
}

// ──── Notificação: Agendamento criado ────────────────────────────

export async function notifyTeamScheduleCreated(params: {
  clientId: string;
  scheduledDate: Date;
  scheduledTime: string;
  description?: string | null;
  creatorName: string;
}) {
  try {
    const team = await getCreatorAndPartners(params.clientId);
    const dateStr = format(params.scheduledDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    const client = await db.client.findUnique({ where: { id: params.clientId }, select: { name: true } });
    const clientName = client?.name || 'Cliente';

    await Promise.allSettled(team.map(async (recipient) => {
      await notifyScheduleCreated({
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        clientName,
        scheduledDate: dateStr,
        scheduledTime: params.scheduledTime,
        description: params.description,
        createdBy: params.creatorName,
        clientId: params.clientId,
      });

      if (recipient.phone) {
        await sendWhatsAppScheduleCreated({
          phone: recipient.phone,
          clientName,
          scheduledDate: dateStr,
          scheduledTime: params.scheduledTime,
          description: params.description,
          createdBy: params.creatorName,
        });
      }
    }));

    console.log(`[NOTIFY] Agendamento notificado para ${team.length} membros do cliente ${clientName}`);
  } catch (error) {
    console.error('[NOTIFY] Erro ao notificar agendamento:', error);
  }
}

// ──── Notificação: Novo parceiro vinculado ────────────────────────

export async function notifyTeamPartnerAdded(params: {
  clientId: string;
  newPartnerName: string;
  addedByName: string;
}) {
  try {
    const client = await db.client.findUnique({ where: { id: params.clientId }, select: { name: true } });
    const clientName = client?.name || 'Cliente';
    const team = await getCreatorAndPartners(params.clientId);

    await Promise.allSettled(team.map(async (recipient) => {
      await notifyPartnerAdded({
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        clientName,
        newPartnerName: params.newPartnerName,
        addedBy: params.addedByName,
        clientId: params.clientId,
      });

      if (recipient.phone) {
        await sendWhatsAppPartnerAdded({
          phone: recipient.phone,
          clientName,
          newPartnerName: params.newPartnerName,
          addedBy: params.addedByName,
        });
      }
    }));

    // Também notificar o novo parceiro (ele mesmo)
    const newPartner = await db.clientPartner.findFirst({
      where: { clientId: params.clientId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, name: true, phone: true } } },
    });
    if (newPartner) {
      await notifyPartnerAdded({
        recipientEmail: newPartner.user.email,
        recipientName: newPartner.user.name,
        clientName,
        newPartnerName: params.newPartnerName,
        addedBy: params.addedByName,
        clientId: params.clientId,
      });
      if (newPartner.user.phone) {
        await sendWhatsApp({
          phone: newPartner.user.phone,
          message: `🤝 *Você foi adicionado como parceiro!*\n\n` +
            `👤 Cliente: ${clientName}\n` +
            `👤 Adicionado por: ${params.addedByName}\n\n` +
            `_CRM Pro_`,
        });
      }
    }

    console.log(`[NOTIFY] Novo parceiro notificado para ${team.length + 1} membros do cliente ${clientName}`);
  } catch (error) {
    console.error('[NOTIFY] Erro ao notificar novo parceiro:', error);
  }
}

// ──── Notificação: Interação registrada ──────────────────────────

export async function notifyTeamInteractionAdded(params: {
  clientId: string;
  interactionDescription: string;
  creatorEmail?: string; // para excluir o autor da notificação
}) {
  try {
    const client = await db.client.findUnique({ where: { id: params.clientId }, select: { name: true } });
    const clientName = client?.name || 'Cliente';
    const team = await getCreatorAndPartners(params.clientId, params.creatorEmail);

    if (team.length === 0) return;

    await Promise.allSettled(team.map(async (recipient) => {
      await notifyInteractionAdded({
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        clientName,
        interactionDescription: params.interactionDescription,
        clientId: params.clientId,
      });

      if (recipient.phone) {
        await sendWhatsAppInteractionAdded({
          phone: recipient.phone,
          clientName,
          interactionDescription: params.interactionDescription,
        });
      }
    }));

    console.log(`[NOTIFY] Interação notificada para ${team.length} parceiros do cliente ${clientName}`);
  } catch (error) {
    console.error('[NOTIFY] Erro ao notificar interação:', error);
  }
}

// ──── Cron: Agendamentos próximos (24h) ────────────────────────

export async function checkAndNotifyUpcomingSchedules() {
  try {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);

    const upcomingSchedules = await db.schedule.findMany({
      where: {
        status: 'PENDING',
        scheduledDate: { lte: tomorrow, gte: now },
      },
      include: {
        client: { select: { id: true, name: true } },
        creatorUser: { select: { id: true, name: true, email: true } },
      },
    });

    if (upcomingSchedules.length === 0) return [];

    const results: Array<{ scheduleId: string; clientName: string; notified: number }> = [];

    for (const schedule of upcomingSchedules) {
      const dateStr = format(new Date(schedule.scheduledDate), "dd 'de' MMMM", { locale: ptBR });
      const team = await getCreatorAndPartners(schedule.client.id);

      await Promise.allSettled(team.map(async (recipient) => {
        await notifyScheduleUpcoming({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          clientName: schedule.client.name,
          scheduledDate: dateStr,
          scheduledTime: schedule.scheduledTime,
          description: schedule.description,
          clientId: schedule.client.id,
        });

        if (recipient.phone) {
          await sendWhatsAppScheduleUpcoming({
            phone: recipient.phone,
            clientName: schedule.client.name,
            scheduledDate: dateStr,
            scheduledTime: schedule.scheduledTime,
          });
        }
      }));

      results.push({ scheduleId: schedule.id, clientName: schedule.client.name, notified: team.length });
    }

    console.log(`[CRON] ${upcomingSchedules.length} agendamentos próximos, notificados para ${results.reduce((sum, r) => sum + r.notified, 0)} usuários`);
    return results;
  } catch (error) {
    console.error('[CRON] Erro ao verificar agendamentos próximos:', error);
    return [];
  }
}

// ──── Cron: Lembretes vencendo ───────────────────────────────────

export async function checkAndNotifyDueReminders() {
  try {
    const now = new Date();

    const dueReminders = await db.reminder.findMany({
      where: {
        dueDate: { lte: now },
        notified: false,
      },
      include: {
        client: { select: { id: true, name: true } },
      },
    });

    if (dueReminders.length === 0) return [];

    const results: Array<{ reminderId: string; clientName: string; notified: number }> = [];

    for (const reminder of dueReminders) {
      const dateStr = format(new Date(reminder.dueDate), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
      const team = await getCreatorAndPartners(reminder.client.id);

      await Promise.allSettled(team.map(async (recipient) => {
        await notifyReminderDue({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          clientName: reminder.client.name,
          reminderTitle: reminder.title,
          reminderDescription: reminder.description,
          dueDate: dateStr,
          clientId: reminder.client.id,
        });

        if (recipient.phone) {
          await sendWhatsAppReminderDue({
            phone: recipient.phone,
            clientName: reminder.client.name,
            reminderTitle: reminder.title,
            reminderDescription: reminder.description,
            dueDate: dateStr,
          });
        }
      }));

      // Marcar como notificado
      await db.reminder.update({
        where: { id: reminder.id },
        data: { notified: true },
      });

      results.push({ reminderId: reminder.id, clientName: reminder.client.name, notified: team.length });
    }

    console.log(`[CRON] ${dueReminders.length} lembretes vencidos, notificados para ${results.reduce((sum, r) => sum + r.notified, 0)} usuários`);
    return results;
  } catch (error) {
    console.error('[CRON] Erro ao verificar lembretes vencidos:', error);
    return [];
  }
}
