import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import * as XLSX from 'xlsx';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    // Validar extensão do arquivo
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const fileName = file.name.toLowerCase();
    const hasValidExtension = validExtensions.some((ext) => fileName.endsWith(ext));

    if (!hasValidExtension) {
      return NextResponse.json(
        { error: 'Formato inválido. Use arquivos .xlsx, .xls ou .csv' },
        { status: 400 }
      );
    }

    // Tamanho máximo: 5MB
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Arquivo muito grande. Tamanho máximo: 5MB' }, { status: 400 });
    }

    // Converter arquivo para buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Parsear planilha
    let rows: Record<string, unknown>[];
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    } catch {
      return NextResponse.json({ error: 'Erro ao ler o arquivo. Verifique se o formato está correto.' }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'O arquivo está vazio ou não contém dados.' }, { status: 400 });
    }

    // Mapear colunas — aceita variações de nome
    const nameKeys = ['nome', 'name', 'Nome', 'NAME', 'Nome do Empreendimento', 'empreendimento'];
    const regionKeys = ['regiao', 'região', 'region', 'Região', 'REGION', 'Regiao', 'Região / Zona'];

    function findKey(row: Record<string, unknown>, keys: string[]): string | null {
      for (const key of keys) {
        if (row[key] !== undefined) return key;
      }
      // Fallback: primeira coluna que parece conter dados
      return null;
    }

    const nameKey = findKey(rows[0], nameKeys) || Object.keys(rows[0])[0];
    const regionKey = findKey(rows[0], regionKeys) || Object.keys(rows[0])[1];

    if (!nameKey) {
      return NextResponse.json(
        { error: 'Não foi possível identificar a coluna "Nome". Use um cabeçalho chamado "Nome" ou "Name".' },
        { status: 400 }
      );
    }

    // Processar linhas
    const results = {
      created: [] as { name: string; region: string | null }[],
      duplicates: [] as { name: string; reason: string }[],
      invalid: [] as { row: number; reason: string }[],
      total: rows.length,
    };

    // Buscar nomes existentes para evitar duplicatas
    const existingEnterprises = await db.enterprise.findMany({
      select: { name: true },
    });
    const existingNames = new Set(existingEnterprises.map((e) => e.name.toLowerCase().trim()));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawName = String(row[nameKey] || '').trim();
      const rawRegion = regionKey ? String(row[regionKey] || '').trim() : '';

      if (!rawName) {
        results.invalid.push({ row: i + 2, reason: 'Nome vazio ou ausente' });
        continue;
      }

      if (existingNames.has(rawName.toLowerCase())) {
        results.duplicates.push({ name: rawName, reason: 'Já existe um empreendimento com este nome' });
        continue;
      }

      try {
        await db.enterprise.create({
          data: {
            name: rawName,
            region: rawRegion || null,
          },
        });
        existingNames.add(rawName.toLowerCase());
        results.created.push({ name: rawName, region: rawRegion || null });
      } catch (err) {
        results.invalid.push({ row: i + 2, reason: 'Erro ao criar registro' });
      }
    }

    return NextResponse.json(results, { status: 200 });
  } catch (error) {
    console.error('Erro ao importar empreendimentos:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
