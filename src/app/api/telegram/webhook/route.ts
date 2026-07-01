import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Telegram Webhook — receives updates from the Telegram Bot.
 *
 * Flow:
 * 1. User sends /start <email> to the bot
 * 2. Telegram forwards the message to this endpoint
 * 3. We look up the CRM user by email and link their telegramChatId
 * 4. Reply with confirmation
 *
 * To set up: POST https://api.telegram.org/bot<TOKEN>/setWebhook?url=<YOUR_DOMAIN>/api/telegram/webhook
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

    if (!BOT_TOKEN) {
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 });
    }

    // Verify this is from Telegram (secret token check)
    const secretToken = request.headers.get('x-telegram-bot-api-secret-token');
    if (process.env.TELEGRAM_WEBHOOK_SECRET && secretToken !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const message = body.message;
    if (!message || !message.text || !message.chat) {
      return NextResponse.json({ ok: true }); // Acknowledge non-message updates silently
    }

    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const firstName = message.from?.first_name || '';

    // Handle /start command with optional email parameter
    if (text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      const emailArg = parts[1]; // e.g., /start user@email.com

      if (!emailArg) {
        await sendTelegramReply(BOT_TOKEN, chatId,
          `👋 Olá${firstName ? ', ' + firstName : ''}!\n\n` +
          `Para vincular seu Telegram ao CRM, envie:\n\n` +
          `<code>/start seu_email@exemplo.com</code>\n\n` +
          `Use o mesmo e-mail com que você faz login no CRM.`
        );
        return NextResponse.json({ ok: true });
      }

      // Look up user by email
      const user = await db.user.findUnique({
        where: { email: emailArg.toLowerCase() },
        select: { id: true, name: true, email: true, telegramChatId: true },
      });

      if (!user) {
        await sendTelegramReply(BOT_TOKEN, chatId,
          `❌ Nenhum usuário encontrado com o e-mail:\n<code>${escapeHtml(emailArg)}</code>\n\n` +
          `Verifique se o e-mail está correto e tente novamente.`
        );
        return NextResponse.json({ ok: true });
      }

      // Check if another user already has this chatId
      const existingOwner = await db.user.findFirst({
        where: { telegramChatId: chatId },
        select: { id: true, name: true, email: true },
      });

      if (existingOwner && existingOwner.id !== user.id) {
        await sendTelegramReply(BOT_TOKEN, chatId,
          `⚠️ Este Telegram já está vinculado a outra conta:\n` +
          `<b>${escapeHtml(existingOwner.name)}</b> (${escapeHtml(existingOwner.email)})\n\n` +
          `Se você é o dono desta conta, entre em contato com o administrador.`
        );
        return NextResponse.json({ ok: true });
      }

      // Link chat ID to user
      await db.user.update({
        where: { id: user.id },
        data: { telegramChatId: chatId },
      });

      await sendTelegramReply(BOT_TOKEN, chatId,
        `✅ <b>Vinculado com sucesso!</b>\n\n` +
        `👤 <b>Nome:</b> ${escapeHtml(user.name)}\n` +
        `📧 <b>E-mail:</b> ${escapeHtml(user.email)}\n\n` +
        `Agora você receberá notificações de novos leads aqui! 🚀`
      );
      return NextResponse.json({ ok: true });
    }

    // Handle /unlink command
    if (text === '/unlink') {
      const user = await db.user.findFirst({
        where: { telegramChatId: chatId },
        select: { id: true, name: true },
      });

      if (!user) {
        await sendTelegramReply(BOT_TOKEN, chatId, 'ℹ️ Nenhuma conta vinculada a este Telegram.');
        return NextResponse.json({ ok: true });
      }

      await db.user.update({
        where: { id: user.id },
        data: { telegramChatId: null },
      });

      await sendTelegramReply(BOT_TOKEN, chatId,
        `🔓 Telegram desvinculado da conta de <b>${escapeHtml(user.name)}</b>.`
      );
      return NextResponse.json({ ok: true });
    }

    // Handle /help command
    if (text === '/help') {
      await sendTelegramReply(BOT_TOKEN, chatId,
        `📖 <b>Comandos disponíveis:</b>\n\n` +
        `<code>/start seu_email</code> — Vincular Telegram ao CRM\n` +
        `<code>/unlink</code> — Desvincular Telegram\n` +
        `<code>/help</code> — Mostrar esta ajuda\n\n` +
        `Após vincular, você receberá notificações automáticas de novos leads.`
      );
      return NextResponse.json({ ok: true });
    }

    // Unknown command — just acknowledge
    return NextResponse.json({ ok: true });

  } catch (error) {
    console.error('[Telegram Webhook] Error:', error);
    return NextResponse.json({ ok: true }); // Always return 200 to Telegram
  }
}

// ── Helpers ──────────────────────────────────────────────────

async function sendTelegramReply(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
  } catch (error) {
    console.error('[Telegram Webhook] Reply failed:', error);
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}