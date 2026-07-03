import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Endpoint TEMPORÁRIO para popular o cachedInfo do Residencial Vitta.
 * Deve ser removido após uso.
 *
 * GET /api/enterprises/seed-vitta-info
 */
export async function GET() {
  try {
    const enterprise = await db.enterprise.findFirst({
      where: { name: { contains: 'Vitta', mode: 'insensitive' } },
      select: { id: true, name: true, cachedInfo: true as any, region: true },
    });

    if (!enterprise) {
      return NextResponse.json({ error: 'Vitta não encontrado' }, { status: 404 });
    }

    const cachedInfo = {
      location: {
        address: 'QNM 29, Área Especial C',
        neighborhood: 'Ceilândia Sul',
        city: 'Brasília',
        state: 'DF',
        region: enterprise.region || 'Ceilândia',
        additionalInfo: 'Em frente ao Hospital Regional de Ceilândia',
      },
      builder: 'Grupo Attos, Habitar Empreendimentos e HC Construtora',
      architecture: null,
      landscaping: null,
      differentials: [
        'Parceria tripartite com 100+ anos de experiência',
        'Enquadramento MCMV com uso de FGTS',
        'Coworking no condomínio',
        '6 lojas comerciais no térreo',
        'Unidades Garden com área privativa de solo',
        'Medição individual de água e energia',
        '3 salões de jogos',
        'Espaço pet dedicado',
      ],
      apartmentTypes: [
        {
          name: 'Tipo 1 Quarto',
          area: '32m²',
          bedrooms: '1 quarto',
          description: 'Sala, cozinha, 1 quarto, 1 banheiro e área de serviço. A partir de R$ 199.900.',
        },
        {
          name: 'Tipo 2 Quartos',
          area: '48m²',
          bedrooms: '2 quartos',
          description: 'Sala, cozinha, 2 quartos, 1 banheiro e área de serviço. A partir de R$ 239.900.',
        },
        {
          name: 'Tipo 2 Quartos Suíte com Varanda',
          area: '52m²',
          bedrooms: '2 quartos (1 suíte)',
          description: 'Sala, cozinha, 2 quartos com 1 suíte, varanda, banheiro social e área de serviço. A partir de R$ 269.900.',
        },
        {
          name: 'Tipo Garden',
          area: '105m²',
          bedrooms: '2 quartos (1 suíte)',
          description: 'Unidade no térreo com área privativa de solo adjacente. A partir de R$ 389.900.',
        },
      ],
      summary: 'Lançamento em comercialização — 2 torres de 19 andares com 291 unidades na QNM 29, Ceilândia Sul. Entrega abril 2029. Aceita FGTS — MCMV. A partir de R$ 199.900.',
    };

    await db.enterprise.update({
      where: { id: enterprise.id },
      data: { cachedInfo: cachedInfo as any },
    });

    return NextResponse.json({
      success: true,
      enterprise: enterprise.name,
      enterpriseId: enterprise.id,
      previousCachedInfo: enterprise.cachedInfo,
      newCachedInfo: cachedInfo,
    });
  } catch (error) {
    console.error('[Seed Vitta Info] Error:', error);
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}