// Server-side PDF text extraction & property parsing for resale listings.
// Uses pdfjs-dist directly (no canvas dependency, works in Vercel serverless).

import { extractTextFromPdf } from './extract-pdf-text';

export interface ParsedProperty {
  sortOrder: number;
  code: string;
  name: string;
  region: string;
  category: string;
  typology: string;
  bedrooms: number | null;
  area: number | null;
  address: string;
  captor: string;
  appointment: string;
  phone: string;
  phoneDigits: string;
  price: number | null;
  condo: number | null;
  iptu: number | null;
  notes: string;
  acceptsFinancing: boolean;
  acceptsFgts: boolean;
  url: string;
  dataNote: string;
  sourcePage?: number;
}

export async function extractPropertiesFromPdf(buffer: Buffer): Promise<{
  properties: ParsedProperty[];
  pageCount: number;
  textLength: number;
  textPreview: string;
}> {
  if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    throw new Error('Arquivo invalido: nao e um PDF valido');
  }
  if (buffer.length > 20 * 1024 * 1024) {
    throw new Error('Arquivo muito grande. Maximo 20 MB.');
  }

  let text = '';
  let pageCount = 0;

  try {
    const result = await extractTextFromPdf(buffer);
    text = result.text;
    pageCount = result.pageCount;
    console.log('[parse-resale-pdf] Text extracted:', text.length, 'chars,', pageCount, 'pages');
    console.log('[parse-resale-pdf] First 500 chars:', text.slice(0, 500));
  } catch (err) {
    console.error('[parse-resale-pdf] pdfjs-dist extraction failed:', err);
    throw new Error('Erro ao extrair texto do PDF: ' + (err instanceof Error ? err.message : String(err)));
  }

  if (!text || text.length < 10) {
    throw new Error('O PDF nao contem texto extraivel (' + text.length + ' chars). Pode ser um arquivo escaneado/imagem.');
  }

  const properties = parseTextToProperties(text);
  if (properties.length === 0) {
    const preview = text.slice(0, 300).replace(/\n/g, ' | ');
    throw new Error('Nenhum imovel foi extraido do PDF. Preview do texto: ' + preview);
  }

  return { properties, pageCount, textLength: text.length, textPreview: text.slice(0, 3000) };
}

function parseTextToProperties(text: string): ParsedProperty[] {
  const lines = text.split('\n').map(l => l.replace(/\u00a0/g, ' ').trim()).filter(Boolean);
  const properties: ParsedProperty[] = [];
  let currentRegion = '';
  let cur: Partial<ParsedProperty> | null = null;
  let orderIdx = 0;

  for (const line of lines) {
    if (isSkipLine(line)) continue;

    const region = detectRegion(line);
    if (region) {
      if (cur?.code) { properties.push(finalize(cur, orderIdx++)); cur = null; }
      currentRegion = region;
      continue;
    }

    const rec = detectRecordStart(line);
    if (rec) {
      if (cur?.code) { properties.push(finalize(cur, orderIdx++)); }
      cur = newProperty(rec.code, currentRegion, orderIdx);
      if (rec.rest.trim()) parseLine(cur, rec.rest);
      continue;
    }

    if (cur?.code) parseLine(cur, line);
  }
  if (cur?.code) properties.push(finalize(cur, orderIdx++));
  return properties;
}

function isSkipLine(line: string): boolean {
  if (/^\d{1,3}$/.test(line.trim())) return true;
  if (/^[\-_=\s]+$/.test(line) && line.length > 5) return true;
  return false;
}

function detectRegion(line: string): string | null {
 const upper = line.toUpperCase().trim();
  if (upper.length > 40) return null;
  if (/\d/.test(upper) && !/ASA\s*NORTE|SUDOESTE|NOROESTE|LESTE|OESTE/i.test(upper)) return null;
  const regionKeywords = [
    'ASA NORTE', 'ASA SUL', 'NORTE', 'SUL', 'LESTE', 'OESTE',
    'CENTRO', 'SUDOESTE', 'NOROESTE', 'CRUZEIRO', 'SQN', 'SQS',
    'SHIS', 'SHIN', 'SHS', 'SHN', 'CLS', 'SCS', 'SCN',
    'LAGO SUL', 'LAGO NORTE', 'PARANOA', 'GAMA', 'TAGUATINGA',
    'CEILANDIA', 'SAMAMBAIA', 'SAO SEBASTIAO', 'ITAPOA', 'RECANTO',
    'RIO DE JANEIRO', 'SAO PAULO', 'BELO HORIZONTE',
  ];
  for (const kw of regionKeywords) {
    if (upper === kw || upper.startsWith(kw + ' ')) return kw;
  }
  if (/^[A-Z][A-Z\s\.]+$/.test(upper) && upper.length >= 4 && upper.length <= 30) {
    const words = upper.split(/\s+/);
    if (words.every(w => w.length > 2 || w === 'DA' || w === 'DE' || w === 'DO' || w === 'DOS' || w === 'DAS')) {
      return upper;
    }
  }
  return null;
}

function detectRecordStart(line: string): { code: string; rest: string } | null {
  const match = line.match(/^\s*(\d+)\s+(RQB\d+)\s*[-\s]*(.*)/i);
  if (match) return { code: match[2].toUpperCase(), rest: match[3] };
  const codeOnly = line.match(/^(RQB\d{3,})\s*[-\s]*(.*)/i);
  if (codeOnly) return { code: codeOnly[1].toUpperCase(), rest: codeOnly[2] };
  return null;
}

function newProperty(code: string, region: string, sortOrder: number): Partial<ParsedProperty> {
  return {
    code, sortOrder, region,
    name: '', address: '', captor: '', appointment: '',
    phone: '', phoneDigits: '', typology: '', notes: '', url: '', dataNote: '',
    category: 'Outro', bedrooms: null, area: null, price: null, condo: null, iptu: null,
    acceptsFinancing: false, acceptsFgts: false,
  };
}

function parseLine(prop: Partial<ParsedProperty>, line: string) {
  const upper = line.toUpperCase();

  // Price detection
  if (!prop.price) {
    const priceMatch = line.match(/R\$\s*([\d.,]+)/);
    if (priceMatch) {
      const val = parseBrlNumber(priceMatch[1]);
      if (val !== null) {
        prop.price = val;
        const after = line.substring(priceMatch.index! + priceMatch[0].length).trim();
        if (after) prop.notes = (prop.notes + ' ' + after).trim();
        return;
      }
    }
  }

  // Condo detection
  if (!prop.condo) {
    const condoMatch = line.match(/cond[oó]minio[:\s]+R\$\s*([\d.,]+)/i);
    if (condoMatch) {
      prop.condo = parseBrlNumber(condoMatch[1]);
      return;
    }
  }

  // IPTU detection
  if (!prop.iptu) {
    const iptuMatch = line.match(/IPTU[:\s]+R\$\s*([\d.,]+)/i);
    if (iptuMatch) {
      prop.iptu = parseBrlNumber(iptuMatch[1]);
      return;
    }
  }

  // URL detection
  const urlMatch = line.match(/(https?:\/\/[\S]+)/);
  if (urlMatch) {
    prop.url = urlMatch[1];
    return;
  }

  // Phone detection
  const phoneMatch = line.match(/(\(\d{2}\)\s?\d{4,5}[-\s]?\d{4})/);
  if (phoneMatch && !prop.phone) {
    prop.phone = phoneMatch[1];
    prop.phoneDigits = normalizePhoneDigits(phoneMatch[1]);
    return;
  }
  // Alternative phone format
  const phoneMatch2 = line.match(/(\d{2}\s?\d{4,5}[-\s]?\d{4})/);
  if (phoneMatch2 && !prop.phone) {
    prop.phone = phoneMatch2[1];
    prop.phoneDigits = normalizePhoneDigits(phoneMatch2[1]);
    return;
  }

  // Typology detection
  if (!prop.typology || prop.typology === '') {
    const typoMatch = line.match(/(\d+\s*(?:QUARTO|QUARTOS|Q|SUITE|SU\u00cdTES))[^\n]*/i);
    if (typoMatch) {
      prop.typology = typoMatch[1].trim();
      const bedMatch = line.match(/(\d+)\s*(?:QUARTO|QUARTOS)/i);
      if (bedMatch) prop.bedrooms = parseInt(bedMatch[1], 10);
      // Category
      prop.category = categorize(prop.typology, prop.name || '', prop.url || '');
      return;
    }
    // Typology without leading digit (e.g. STUDIO, KITNET)
    const typoMatch2 = line.match(/(STUDIO|KITNET|SALA\s+COMERCIAL|LOJA|GALP\u00c3O|FLAT)/i);
    if (typoMatch2) {
      prop.typology = typoMatch2[1].toUpperCase();
      prop.category = categorize(prop.typology, prop.name || '', prop.url || '');
      return;
    }
  }

  // Area detection
  if (prop.area === null) {
    const areaMatch = line.match(/([\d.,]+)\s*m[\u00b2\u00b32]/);
    if (areaMatch) {
      const val = parseBrlNumber(areaMatch[1]);
      if (val !== null) {
        prop.area = val;
        if (areaMatch[1].includes('m3') || line.includes('m3') || line.includes('m\u00b3')) {
          prop.dataNote = (prop.dataNote ? prop.dataNote + '; ' : '') + 'Unidade de area suspeita (m3 em vez de m2)';
        }
        return;
      }
    }
  }

  // Address detection (contains common address terms)
  if (!prop.address && (
    /(?:RUA|AVENIDA|AV\.?|TRAVESSA|SQN|SQS|SHIS|SHIN|SHS|SHN|CLS|SCS|SCN|BLOCO|CONJUNTO|N[\u00ba\u00ba])/i.test(line)
  )) {
    prop.address = line.trim();
    return;
  }

  // Captor detection (typically a name before phone)
  if (!prop.captor && /[A-Z][a-z]+ [A-Z][a-z]+/.test(line) && !prop.phone) {
    prop.captor = line.trim();
    return;
  }

  // Name: if we don't have a name yet and line looks like a property name
  if ((!prop.name || prop.name === '') && !/[\d]{3,}/.test(line) && line.length > 5 && line.length < 120 && !line.startsWith('http')) {
    prop.name = (prop.name + ' ' + line).trim();
    return;
  }

  // Appointment / scheduling
  if (/agend|horar|visita|contat/i.test(line)) {
    prop.appointment = line.trim();
    return;
  }

  // Notes (financing, FGTS, etc.)
  if (/financiamento|FGTS/i.test(line)) {
    prop.notes = (prop.notes + ' ' + line).trim();
    return;
  }

  // Default: append to notes if property is mostly filled
  if (prop.name || prop.price) {
    prop.notes = (prop.notes + ' ' + line).trim();
  }
}

function finalize(p: Partial<ParsedProperty>, orderIdx: number): ParsedProperty {
  const name = (p.name || '').trim();
  const notes = (p.notes || '').trim();
  const typology = (p.typology || '').trim();
  const category = p.category || categorize(typology, name, p.url || '');
  const phoneDigits = p.phoneDigits || (p.phone ? normalizePhoneDigits(p.phone) : '');
  return {
    sortOrder: p.sortOrder ?? orderIdx,
    code: p.code || '',
    name,
    region: p.region || '',
    category,
    typology,
    bedrooms: p.bedrooms ?? null,
    area: p.area ?? null,
    address: (p.address || '').trim(),
    captor: (p.captor || '').trim(),
    appointment: (p.appointment || '').trim(),
    phone: (p.phone || '').trim(),
    phoneDigits,
    price: p.price ?? null,
    condo: p.condo ?? null,
    iptu: p.iptu ?? null,
    notes,
    acceptsFinancing: checkFinancing(notes),
    acceptsFgts: checkFgts(notes),
    url: (p.url || '').trim(),
    dataNote: (p.dataNote || '').trim(),
    sourcePage: p.sourcePage,
  };
}

function parseBrlNumber(text: string): number | null {
  if (!text) return null;
  let cleaned = text.replace(/R\$/g, '').replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function normalizePhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  if (digits.length === 8) return '5561' + digits;
  return digits;
}

function categorize(typology: string, name: string, url: string): string {
  const tu = typology.toUpperCase();
  const nu = name.toUpperCase();
  const ul = url.toLowerCase();
  if (tu.includes('LOTE') || tu.includes('TERRENO') || ul.includes('/lote')) return 'Lote';
  if (tu.includes('SALA') || tu.includes('LOJA') || tu.includes('COMERCIAL') || tu.includes('GALPAO')) return 'Comercial';
  if (nu.includes('HOTEL-FLAT') || nu.includes('APART-HOTEL') || nu.includes('FLAT') || ul.includes('flat')) return 'Flat';
  if (tu.includes('CASA') || tu.includes('SOBRADO') || tu.includes('RESIDENCIA') || nu.includes('CASA')) return 'Casa';
  if (tu.includes('APARTAMENTO') || tu.includes('STUDIO') || tu.includes('KITNET') ||
      tu.includes('1 QUARTO') || tu.includes('2 QUARTOS') || tu.includes('3 QUARTOS') ||
      tu.includes('4 QUARTOS') || tu.includes('5 QUARTOS')) return 'Apartamento';
  return 'Outro';
}

function checkFinancing(notes: string): boolean {
  if (!notes) return false;
  const l = notes.toLowerCase();
  if (l.includes('nao aceita financiamento') || l.includes('não aceita financiamento')) return false;
  return l.includes('aceita financiamento') || l.includes('aceita financ');
}

function checkFgts(notes: string): boolean {
  if (!notes) return false;
  const l = notes.toLowerCase();
  if (l.includes('nao aceita fgts') || l.includes('não aceita fgts')) return false;
  return l.includes('aceita fgts');
}
