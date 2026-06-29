import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireAuth } from '@/lib/api-auth';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
];
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

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

    // Validação de tamanho
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Arquivo muito grande. Tamanho máximo: 5MB' },
        { status: 400 }
      );
    }

    // Validação de tipo por extensão
    const fileName = (file.name || '').toLowerCase();
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext));
    if (!hasValidExtension) {
      return NextResponse.json(
        { error: 'Tipo de arquivo inválido. Use .xlsx, .xls ou .csv' },
        { status: 400 }
      );
    }

    // Validação MIME type
    if (file.type && !ALLOWED_MIME_TYPES.includes(file.type) && !hasValidExtension) {
      return NextResponse.json(
        { error: 'Tipo de arquivo não suportado' },
        { status: 400 }
      );
    }

    // Validação de linhas máximas (proteção contra denial of service)
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(worksheet);

    if (rows.length === 0) {
      return NextResponse.json({ imported: 0, errors: ['Arquivo vazio ou sem dados'] });
    }

    if (rows.length > 1000) {
      return NextResponse.json(
        { imported: 0, errors: ['Arquivo contém mais de 1000 linhas. Divida em arquivos menores.'] },
        { status: 400 }
      );
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

      // Sanitizar nome: remover caracteres perigosos
      const sanitizedName = name.replace(/[<>'"&]/g, '').substring(0, 200);

      const updatePeriodStr = (row['Período de Atualização'] || row['Periodo'] || row['periodo'] || '30').toString().trim();
      const updatePeriod = [15, 20, 30].includes(parseInt(updatePeriodStr))
        ? parseInt(updatePeriodStr)
        : 30;

      try {
        await db.client.create({
          data: {
            name: sanitizedName,
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
        errors.push(`Linha ${rowNum}: Erro ao importar "${sanitizedName}"`);
      }
    }

    return NextResponse.json({ imported, errors });
  } catch (error) {
    console.error('Error importing file:', error);
    return NextResponse.json({ error: 'Erro ao processar arquivo' }, { status: 500 });
  }
}
