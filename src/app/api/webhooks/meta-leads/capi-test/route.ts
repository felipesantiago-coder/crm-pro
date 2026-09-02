import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { sendTestCapEvent } from '@/lib/meta-conversions';

/**
 * Endpoint de teste do CAPI — envia um evento de teste para a Meta.
 * O evento aparece na aba "Eventos de teste" do Gerenciador de Eventos.
 */
export async function POST(request: Request) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const body = await request.json();
    const { accessToken, datasetId } = body;

    if (!accessToken || !datasetId) {
      return NextResponse.json(
        { error: 'Access Token e Dataset ID são obrigatórios' },
        { status: 400 }
      );
    }

    const result = await sendTestCapEvent(accessToken, datasetId);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Meta CAPI Test] Erro:', error);
    return NextResponse.json({ error: 'Erro ao enviar evento de teste' }, { status: 500 });
  }
}
