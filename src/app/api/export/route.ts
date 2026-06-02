import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function GET() {
  try {
    const clients = await db.client.findMany({
      include: {
        tags: {
          include: { tag: true },
        },
      },
      orderBy: { createdAt: 'desc' },
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
