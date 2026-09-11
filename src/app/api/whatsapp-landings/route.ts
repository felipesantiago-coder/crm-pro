import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import {
  DEFAULT_WHATSAPP_LANDING_MESSAGE,
  generateLandingSlug,
  isValidLandingSlug,
  normalizeLandingPhone,
} from '@/lib/whatsapp-landing';

// GET /api/whatsapp-landings — lista landings de WhatsApp (admin)
export async function GET() {
  try {
    const { error } = await requireAdmin();
    if (error) return error;
    const landings = await db.whatsAppLanding.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ landings });
  } catch (err) {
    console.error('[WhatsApp Landings] Erro ao listar:', err);
    return NextResponse.json({ error: 'Erro ao listar landings de WhatsApp' }, { status: 500 });
  }
}

// POST /api/whatsapp-landings — cria landing "Clique para Entrar" (admin)
export async function POST(req: NextRequest) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const body = await req.json().catch(() => null);
    const region = typeof body?.region === 'string' ? body.region.trim() : '';
    const phoneInput = typeof body?.phone === 'string' ? body.phone : '';
    const message =
      typeof body?.message === 'string' && body.message.trim() ? body.message.trim() : DEFAULT_WHATSAPP_LANDING_MESSAGE;
    const slugInput = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    const active = body?.active === undefined ? true : Boolean(body.active);

    if (!region) {
      return NextResponse.json({ error: 'Informe a região da landing' }, { status: 400 });
    }
    if (region.length > 120) {
      return NextResponse.json({ error: 'Região muito longa (máx. 120 caracteres)' }, { status: 400 });
    }

    const phone = normalizeLandingPhone(phoneInput);
    if (!phone.ok) {
      return NextResponse.json({ error: phone.error }, { status: 400 });
    }

    const slug = slugInput || generateLandingSlug(region);
    if (!slug) {
      return NextResponse.json({ error: 'Não foi possível gerar o slug — informe um manualmente' }, { status: 400 });
    }
    if (!isValidLandingSlug(slug)) {
      return NextResponse.json(
        { error: 'Slug inválido. Use apenas letras minúsculas, números e hífens.' },
        { status: 400 },
      );
    }

    const clash = await db.whatsAppLanding.findUnique({ where: { slug }, select: { id: true } });
    if (clash) {
      return NextResponse.json({ error: `Já existe uma landing com o slug "${slug}"` }, { status: 409 });
    }

    const landing = await db.whatsAppLanding.create({
      data: { slug, region, phone: phone.value, message, active },
    });
    return NextResponse.json({ landing }, { status: 201 });
  } catch (err) {
    console.error('[WhatsApp Landings] Erro ao criar:', err);
    return NextResponse.json({ error: 'Erro ao criar landing de WhatsApp' }, { status: 500 });
  }
}
