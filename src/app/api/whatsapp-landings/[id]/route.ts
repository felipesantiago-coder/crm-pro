import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import {
  DEFAULT_WHATSAPP_LANDING_MESSAGE,
  isValidLandingSlug,
  normalizeLandingPhone,
} from '@/lib/whatsapp-landing';

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/whatsapp-landings/[id] — atualiza campos da landing (admin)
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;
    const { id } = await ctx.params;

    const existing = await db.whatsAppLanding.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Landing não encontrada' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Payload inválido' }, { status: 400 });
    }

    const data: {
      region?: string;
      phone?: string;
      message?: string;
      active?: boolean;
      slug?: string;
    } = {};

    if (body.region !== undefined) {
      const region = typeof body.region === 'string' ? body.region.trim() : '';
      if (!region) return NextResponse.json({ error: 'Informe a região da landing' }, { status: 400 });
      if (region.length > 120) {
        return NextResponse.json({ error: 'Região muito longa (máx. 120 caracteres)' }, { status: 400 });
      }
      data.region = region;
    }

    if (body.phone !== undefined) {
      const phone = normalizeLandingPhone(typeof body.phone === 'string' ? body.phone : '');
      if (!phone.ok) return NextResponse.json({ error: phone.error }, { status: 400 });
      data.phone = phone.value;
    }

    if (body.message !== undefined) {
      // Vazio → volta para a mensagem padrão do produto
      const message =
        typeof body.message === 'string' && body.message.trim()
          ? body.message.trim()
          : DEFAULT_WHATSAPP_LANDING_MESSAGE;
      data.message = message;
    }

    if (body.active !== undefined) {
      data.active = Boolean(body.active);
    }

    if (body.slug !== undefined) {
      const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
      if (!slug || !isValidLandingSlug(slug)) {
        return NextResponse.json(
          { error: 'Slug inválido. Use apenas letras minúsculas, números e hífens.' },
          { status: 400 },
        );
      }
      if (slug !== existing.slug) {
        const clash = await db.whatsAppLanding.findUnique({ where: { slug }, select: { id: true } });
        if (clash && clash.id !== id) {
          return NextResponse.json({ error: `Já existe uma landing com o slug "${slug}"` }, { status: 409 });
        }
      }
      data.slug = slug;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 });
    }

    const landing = await db.whatsAppLanding.update({ where: { id }, data });
    return NextResponse.json({ landing });
  } catch (err) {
    console.error('[WhatsApp Landings] Erro ao atualizar:', err);
    return NextResponse.json({ error: 'Erro ao atualizar landing de WhatsApp' }, { status: 500 });
  }
}

// DELETE /api/whatsapp-landings/[id] — exclui a landing (admin)
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;
    const { id } = await ctx.params;

    const existing = await db.whatsAppLanding.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Landing não encontrada' }, { status: 404 });
    }

    await db.whatsAppLanding.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[WhatsApp Landings] Erro ao excluir:', err);
    return NextResponse.json({ error: 'Erro ao excluir landing de WhatsApp' }, { status: 500 });
  }
}
