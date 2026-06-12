import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireAuth } from '@/lib/api-auth';

export async function POST(request: NextRequest) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const userId = session!.user.id;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(worksheet);

    if (rows.length === 0) {
      return NextResponse.json({ imported: 0, errors: ['Arquivo vazio ou sem dados'] });
    }

    let imported = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      const name = (row['Nome'] || row['nome'] || '').toString().trim();
      const phone = (row['Telefone'] || row['telefone'] || '').toString().trim() || null;
      const email = (row['Email'] || row['email'] || '').toString().trim() || null;
      const region = (row['Região'] || row['Regiao'] || row['região'] || row['regiao'] || '').toString().trim() || null;
      const enterprise = (row['Empreendimento'] || row['empreendimento'] || '').toString().trim() || null;

      if (!name) {
        errors.push(`Linha ${rowNum}: Nome é obrigatório`);
        continue;
      }

      const updatePeriodStr = (row['Período de Atualização'] || row['Periodo'] || row['periodo'] || '30').toString().trim();
      const updatePeriod = [15, 20, 30].includes(parseInt(updatePeriodStr))
        ? parseInt(updatePeriodStr)
        : 30;

      try {
        await db.client.create({
          data: {
            name,
            phone,
            email,
            region,
            enterprise,
            updatePeriod,
            createdBy: userId,
          },
        });
        imported++;
      } catch (err) {
        errors.push(`Linha ${rowNum}: Erro ao importar "${name}"`);
      }
    }

    return NextResponse.json({ imported, errors });
  } catch (error) {
    console.error('Error importing file:', error);
    return NextResponse.json({ error: 'Erro ao processar arquivo' }, { status: 500 });
  }
}
