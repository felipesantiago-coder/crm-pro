import { Resend } from 'resend';

let _resend: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

const FROM_NAME = 'CRM Pro';
const FROM_EMAIL = process.env.NOTIFICATION_FROM_EMAIL || 'noreply@crmpro.app';

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
}

function emailHtml(body: string, title: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#10b981,#0d9488); padding:24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:20px;font-weight:700;color:#ffffff;">CRM Pro</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 24px; border-top:1px solid #e2e8f0;">
              <p style="margin:0; font-size:12px; color:#94a3b8; text-align:center;">
                Enviado automaticamente pelo CRM Pro &bull; ${new Date().toLocaleDateString('pt-BR')}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function textRow(label: string, value: string): string {
  return `
              <p style="margin:0 0 4px; font-size:13px; color:#64748b; font-weight:500;">${label}</p>
              <p style="margin:0 0 16px; font-size:15px; color:#1e293b; font-weight:400;">${value}</p>`;
}

export async function sendEmail({
  to,
  subject,
  htmlBody,
}: {
  to: string;
  subject: string;
  htmlBody: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.log('[EMAIL] RESEND_API_KEY não configurada — e-mail não enviado:', to, subject);
    return false;
  }

  try {
    await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html: htmlBody,
    });
    console.log('[EMAIL] Enviado para:', to, '| Assunto:', subject);
    return true;
  } catch (error) {
    console.error('[EMAIL] Erro ao enviar:', error);
    return false;
  }
}

// ──── Template: Agendamento criado ────────────────────────────────
export async function notifyScheduleCreated(params: {
  recipientEmail: string;
  recipientName: string;
  clientName: string;
  scheduledDate: string;
  scheduledTime: string;
  description?: string | null;
  createdBy: string;
  clientId: string;
}) {
  const { recipientEmail, recipientName, clientName, scheduledDate, scheduledTime, description, createdBy, clientId } = params;
  const url = `${appUrl()}#/client/${clientId}`;

  const body = `
              <p style="margin:0 0 20px; font-size:15px; color:#1e293b;">Olá, <strong>${recipientName}</strong>!</p>
              <p style="margin:0 0 20px; font-size:15px; color:#334155;">Uma visita foi agendada para o cliente <strong>${clientName}</strong>:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc; border-radius:12px; padding:16px; margin:0 0 20px;">
                <tr><td style="padding:12px 16px;">
                  ${textRow('Cliente', clientName)}
                  ${textRow('Data', scheduledDate)}
                  ${textRow('Horário', scheduledTime)}
                  ${textRow('Agendado por', createdBy)}
                  ${description ? textRow('Observações', description) : ''}
                </td></tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td align="center">
                    <a href="${url}" style="display:inline-block; padding:12px 32px; background:linear-gradient(135deg,#10b981,#0d9488); color:#ffffff; text-decoration:none; border-radius:8px; font-size:14px; font-weight:600;">
                      Ver no CRM
                    </a>
                  </td>
                </tr>
              </table>`;

  return sendEmail({
    to: recipientEmail,
    subject: `[CRM Pro] Visita agendada: ${clientName} — ${scheduledDate} às ${scheduledTime}`,
    htmlBody: emailHtml(body, `Visita agendada: ${clientName}`),
  });
}

// ──── Template: Lembrete vencendo ────────────────────────────────
export async function notifyReminderDue(params: {
  recipientEmail: string;
  recipientName: string;
  clientName: string;
  reminderTitle: string;
  reminderDescription?: string | null;
  dueDate: string;
  clientId: string;
}) {
  const { recipientEmail, recipientName, clientName, reminderTitle, reminderDescription, dueDate, clientId } = params;
  const url = `${appUrl()}#/client/${clientId}`;

  const body = `
              <p style="margin:0 0 20px; font-size:15px; color:#1e293b;">Olá, <strong>${recipientName}</strong>!</p>
              <p style="margin:0 0 20px; font-size:15px; color:#334155;">Um lembrete venceu para o cliente <strong>${clientName}</strong>:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2; border:1px solid #fecaca; border-radius:12px; margin:0 0 20px;">
                <tr><td style="padding:16px;">
                  ${textRow('Lembrete', reminderTitle)}
                  ${reminderDescription ? textRow('Descrição', reminderDescription) : ''}
                  ${textRow('Data de vencimento', dueDate)}
                </td></tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td align="center">
                    <a href="${url}" style="display:inline-block; padding:12px 32px; background:linear-gradient(135deg,#10b981,#0d9488); color:#ffffff; text-decoration:none; border-radius:8px; font-size:14px; font-weight:600;">
                      Ver no CRM
                    </a>
                  </td>
                </tr>
              </table>`;

  return sendEmail({
    to: recipientEmail,
    subject: `[CRM Pro] Lembrete vencido: ${reminderTitle} — ${clientName}`,
    htmlBody: emailHtml(body, `Lembrete vencido: ${reminderTitle}`),
  });
}

// ──── Template: Novo parceiro vinculado ─────────────────────────
export async function notifyPartnerAdded(params: {
  recipientEmail: string;
  recipientName: string;
  clientName: string;
  newPartnerName: string;
  addedBy: string;
  clientId: string;
}) {
  const { recipientEmail, recipientName, clientName, newPartnerName, addedBy, clientId } = params;
  const url = `${appUrl()}#/client/${clientId}`;

  const body = `
              <p style="margin:0 0 20px; font-size:15px; color:#1e293b;">Olá, <strong>${recipientName}</strong>!</p>
              <p style="margin:0 0 20px; font-size:15px; color:#334155;">
                O usuário <strong>${newPartnerName}</strong> foi adicionado como parceiro do cliente <strong>${clientName}</strong> por <strong>${addedBy}</strong>.
              </p>
              <p style="margin:0 0 20px; font-size:15px; color:#334155;">
                Agora vocês podem acompanhar juntos esse cliente e registrar interações compartilhadas.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td align="center">
                    <a href="${url}" style="display:inline-block; padding:12px 32px; background:linear-gradient(135deg,#10b981,#0d9488); color:#ffffff; text-decoration:none; border-radius:8px; font-size:14px; font-weight:600;">
                      Ver no CRM
                    </a>
                  </td>
                </tr>
              </table>`;

  return sendEmail({
    to: recipientEmail,
    subject: `[CRM Pro] Novo parceiro em ${clientName}: ${newPartnerName}`,
    htmlBody: emailHtml(body, `Novo parceiro: ${newPartnerName}`),
  });
}

// ──── Template: Nova interação registrada ───────────────────────
export async function notifyInteractionAdded(params: {
  recipientEmail: string;
  recipientName: string;
  clientName: string;
  interactionDescription: string;
  clientId: string;
}) {
  const { recipientEmail, recipientName, clientName, interactionDescription, clientId } = params;
  const url = `${appUrl()}#/client/${clientId}`;

  const body = `
              <p style="margin:0 0 20px; font-size:15px; color:#1e293b;">Olá, <strong>${recipientName}</strong>!</p>
              <p style="margin:0 0 20px; font-size:15px; color:#334155;">Uma nova observação foi registrada no cliente <strong>${clientName}</strong>:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; margin:0 0 20px;">
                <tr><td style="padding:16px;">
                  <p style="margin:0; font-size:14px; color:#1e293b; line-height:1.6; white-space:pre-wrap;">${interactionDescription}</p>
                </td></tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td align="center">
                    <a href="${url}" style="display:inline-block; padding:12px 32px; background:linear-gradient(135deg,#10b981,#0d9488); color:#ffffff; text-decoration:none; border-radius:8px; font-size:14px; font-weight:600;">
                      Ver no CRM
                    </a>
                  </td>
                </tr>
              </table>`;

  return sendEmail({
    to: recipientEmail,
    subject: `[CRM Pro] Nova observação em ${clientName}`,
    htmlBody: emailHtml(body, `Nova observação: ${clientName}`),
  });
}

// ──── Template: Agendamento próximo (cron) ───────────────────────
export async function notifyScheduleUpcoming(params: {
  recipientEmail: string;
  recipientName: string;
  clientName: string;
  scheduledDate: string;
  scheduledTime: string;
  description?: string | null;
  clientId: string;
}) {
  const { recipientEmail, recipientName, clientName, scheduledDate, scheduledTime, description, clientId } = params;
  const url = `${appUrl()}#/client/${clientId}`;

  const body = `
              <p style="margin:0 0 20px; font-size:15px; color:#1e293b;">Olá, <strong>${recipientName}</strong>!</p>
              <p style="margin:0 0 20px; font-size:15px; color:#334155;">
                ⏰ Uma visita agendada está próxima para o cliente <strong>${clientName}</strong>!
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb; border:1px solid #fde68a; border-radius:12px; margin:0 0 20px;">
                <tr><td style="padding:16px;">
                  ${textRow('Cliente', clientName)}
                  ${textRow('Data', scheduledDate)}
                  ${textRow('Horário', scheduledTime)}
                  ${description ? textRow('Observações', description) : ''}
                </td></tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td align="center">
                    <a href="${url}" style="display:inline-block; padding:12px 32px; background:linear-gradient(135deg,#10b981,#0d9488); color:#ffffff; text-decoration:none; border-radius:8px; font-size:14px; font-weight:600;">
                      Ver no CRM
                    </a>
                  </td>
                </tr>
              </table>`;

  return sendEmail({
    to: recipientEmail,
    subject: `[CRM Pro] Lembrete de visita: ${clientName} — hoje às ${scheduledTime}`,
    htmlBody: emailHtml(body, `Visita próxima: ${clientName}`),
  });
}
