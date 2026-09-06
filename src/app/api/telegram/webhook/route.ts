import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';

/**
 * Telegram Webhook — receives updates from the Bot.
 *
 * Fluxo de vinculação SEGURA (§18.1):
 * 1. Usuário autenticado no CRM gera um convite (POST /api/telegram/link-token)
 * 2. Abre o deep link https://t.me/<bot>?start=<token-opaco> e envia /start <token>
 * 3. Este endpoint valida: hash, validade (TTL), uso único, chat PRIVADO,
 *    e vincula o chat ao usuário esperado — prova de posse do canal.
 *
 * Compatibilidade (desativação progressiva): /start <email> continua
 * aceito, mas confirma apenas o CONHECIMENTO do endereço — a UI do CRM
 * não o recomenda mais e orienta o convite seguro.
 *
 * To set up: POST https://api.telegram.org/bot<TOKEN>/setWebhook?url=<YOUR_DOMAIN>/api/telegram/webhook
 */

/** /start <token-opaco>: 48 hex chars gerados pelo CRM. */
const LINK_TOKEN_PATTERN = /^[0-9a-f]{48}$/;

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

    // Handle /start command with optional parameter (token seguro ou e-mail legado)
    if (text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      const arg = parts[1]; // token opaco OU e-mail

      if (!arg) {
        await sendTelegramReply(BOT_TOKEN, chatId,
          `👋 Olá${firstName ? ', ' + escapeHtml(firstName) : ''}!\n\n` +
          `Para vincular este Telegram ao CRM, abra <b>Ajustes → Notificações</b> ` +
          `no CRM e toque em <b>“Vincular Telegram”</b> — o convite chega por aqui.\n\n` +
          `Ou envie: <code>/start seu_email@exemplo.com</code>`
        );
        return NextResponse.json({ ok: true });
      }

      // ── Fluxo seguro: /start <token-opaco> (prova de posse, §18.1) ──
      if (LINK_TOKEN_PATTERN.test(arg)) {
        const tokenHash = createHash('sha256').update(arg).digest('hex');
        const linkToken = await db.telegramLinkToken.findUnique({
          where: { tokenHash },
          select: { id: true, userId: true, expiresAt: true, usedAt: true },
        });

        const invalid = !linkToken
          ? 'Token de vinculação inválido.'
          : linkToken.usedAt
            ? 'Este convite já foi utilizado — gere um novo no CRM.'
            : linkToken.expiresAt < new Date()
              ? 'Este convite expirou — gere um novo no CRM (vale 15 minutos).'
              : null;

        if (invalid) {
          await sendTelegramReply(BOT_TOKEN, chatId, `❌ ${invalid}`);
          return NextResponse.json({ ok: true });
        }

        // Convite só vale para o chat PRIVADO do usuário esperado (§18.1)
        if (message.chat.type !== 'private') {
          await sendTelegramReply(BOT_TOKEN, chatId,
            `❌ A vinculação só é permitida em chat PRIVADO com o bot.`
          );
          return NextResponse.json({ ok: true });
        }

        const expectedUser = await db.user.findUnique({
          where: { id: linkToken!.userId },
          select: { id: true, name: true, email: true, telegramChatId: true },
        });
        if (!expectedUser) {
          await sendTelegramReply(BOT_TOKEN, chatId,
            '❌ Conta do convite não encontrada — peça um novo convite ao administrador.'
          );
          return NextResponse.json({ ok: true });
        }

        // Chat já pertence a outro usuário? Não rouba o vínculo.
        const existingOwner = await db.user.findFirst({
          where: { telegramChatId: chatId },
          select: { id: true, name: true },
        });
        if (existingOwner && existingOwner.id !== expectedUser.id) {
          await sendTelegramReply(BOT_TOKEN, chatId,
            `⚠️ Este Telegram já está vinculado a outra conta:\n` +
            `<b>${escapeHtml(existingOwner.name)}</b>\n\n` +
            `Desvincule primeiro com /unlink.`
          );
          return NextResponse.json({ ok: true });
        }

        // Vincula e consome o token (uso único, atômico o suficiente:
        // usedAt evita reuso em replays)
        await db.$transaction([
          db.user.update({
            where: { id: expectedUser.id },
            data: { telegramChatId: chatId },
          }),
          db.telegramLinkToken.update({
            where: { id: linkToken!.id },
            data: { usedAt: new Date() },
          }),
        ]).catch(async () => {
          // PgBouncer/transaction pooler: fallback sem transação interativa
          await db.user.update({ where: { id: expectedUser.id }, data: { telegramChatId: chatId } });
          await db.telegramLinkToken.update({ where: { id: linkToken!.id }, data: { usedAt: new Date() } });
        });

        await sendTelegramReply(BOT_TOKEN, chatId,
          `✅ <b>Vinculado com sucesso!</b>\n\n` +
          `👤 <b>Nome:</b> ${escapeHtml(expectedUser.name)}\n\n` +
          `Você receberá aqui o cartão dos leads atribuídos a você. 🎉`
        );
        return NextResponse.json({ ok: true });
      }

      // ── Fluxo legado: /start <email> (desativação progressiva) ──
      const emailArg = arg;

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
        `Agora você receberá notificações de novos leads aqui! 🚀\n\n` +
        `<i>Dica: prefira sempre o convite gerado em Ajustes → Notificações — ele confirma que este chat é seu.</i>`
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
        `<code>/unlink</code> — Desvincular Telegram\n` +
        `<code>/help</code> — Mostrar esta ajuda\n\n` +
        `Para VINCULAR, gere o convite em Ajustes → Notificações no CRM ` +
        `e toque no link do bot.\n\n` +
        `Após vincular, você receberá o cartão dos leads atribuídos a você.`
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });

    clearTimeout(timeoutId);

    const data = await res.json();
    if (!data.ok) {
      console.error(`[Telegram Webhook] Reply failed: ${data.description}`, { chatId });
    }
  } catch (error) {
    console.error('[Telegram Webhook] Reply failed:', error);
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}