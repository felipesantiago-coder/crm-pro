import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireAuth } from '@/lib/api-auth';

const EXPORT_LIMIT = 10000;

export async function GET() {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    // Buscar usuário para filtro de acesso
    const currentUser = await db.user.findUnique({
      where: { email: session!.user!.email! },
      select: { id: true, role: true },
    });
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const isAdmin = currentUser.role === 'ADMIN';
    const accessFilter = isAdmin ? {} : {
      OR: [
        { createdBy: currentUser.id },
        { partners: { some: { userId: currentUser.id } } },
      ],
    };

    const total = await db.client.count({ where: accessFilter });
    if (total > EXPORT_LIMIT) {
      console.warn(`[EXPORT] Total clients (${total}) exceeds limit (${EXPORT_LIMIT}). Exporting first ${EXPORT_LIMIT}.`);
    }

    const clients = await db.client.findMany({
      where: accessFilter,
      include: {
        tags: {
          include: { tag: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
    });

    const data = clients.map((client) => ({
      Nome: client.name,
      Telefone: client.phone || '',
      Email: client.email || '',
      Região: client.region || '',
      Empreendimento: client.enterprise || '',
      'Período de Atualização (dias)': client.updatePeriod || 30,
      'Última Interação': client.lastInteractionAt
        ? client.lastInteractionAt.toISOString().split('T')[0]
        : '',
      Tags: client.tags.map((ct) => ct.tag.name).join(', '),
      'Data de Criação': client.createdAt.toISOString().split('T')[0],
      Observações: client.notes || '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);

    worksheet['!cols'] = [
      { wch: 30 },
      { wch: 20 },
      { wch: 30 },
      { wch: 20 },
      { wch: 25 },
      { wch: 15 },
      { wch: 20 },
      { wch: 25 },
      { wch: 15 },
      { wch: 40 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Clientes');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="clientes.xlsx"',
      },
    });
  } catch (error) {
    console.error('Error exporting clients:', error);
    return NextResponse.json({ error: 'Erro ao exportar clientes' }, { status: 500 });
  }
}
