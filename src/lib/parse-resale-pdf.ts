// Server-side PDF text extraction & property parsing for resale listings.
// Uses pdf-parse v1.1.1 (bundles pdfjs-dist v2 internally).
// Works in Vercel serverless out of the box.

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

// ─── Constants ─────────────────────────────────────────────────────────────

const REGION_KEYWORDS = [
  'ASA NORTE', 'ASA SUL', 'NORTE', 'SUL', 'LESTE', 'OESTE',
  'CENTRO', 'SUDOESTE', 'NOROESTE', 'CRUZEIRO',
  'LAGO SUL', 'LAGO NORTE', 'PARANOA', 'GAMA', 'TAGUATINGA',
  'CEILANDIA', 'SAMAMBAIA', 'SAO SEBASTIAO', 'ITAPOA', 'RECANTO',
  'RIO DE JANEIRO', 'SAO PAULO', 'BELO HORIZONTE',
  'ARNIQUEIRAS', 'VICENTE PIRES', 'SAAN', 'RIACHO FUNDO',
  'SOBRADINHO', 'PARK SUL', 'JARDIM BOTANICO', 'JARDIM BOTÂNICO',
  'GUARA', 'AGUAS CLARAS', 'ÁGUAS CLARAS',
  'PARK WAY', 'SHIS', 'SHIN', 'SHS', 'SHN',
];

// Patterns that indicate a field boundary in concatenated text
const TYPOLOGY_PATTERNS = [
  /^(\d+)\s*(?:QUARTO|QUARTOS|SU[IÍ]TES?)/i,
  /^(SALA(?:\s+COMERCIAL)?|LOJA(?:\s+COMERCIAL)?|GALP[AÃO]|LOTE\s*H[ií]BRIDO|LOTE|STUDIO|KITNET|FLAT|CASA)/i,
];

const AREA_PATTERN = /^([\d.,]+)\s*m[²2]/;

// ─── Region detection by address heuristics ───────────────────────────────

const ADDRESS_REGION_RULES: [RegExp, string][] = [
  [/\bSHTN\b|\bSHN\b|\bSGAN\b|\bSQN\s*\d|\bSEPN\b|\bSIG\b|\bSGCV\b|\bSCN\b|Bras[ií]lia\s*Shopping/i, 'ASA NORTE'],
  [/\bSCES\b|\bSQS\s*\d|\bSCS\b|\bSCLN\b|\bCLS\b|\bSQSW\s*305/i, 'ASA SUL'],
  [/\bSQNW\b/i, 'NOROESTE'],
  [/\bSQSW\b/i, 'SUDOESTE'],
  [/\bPark\s*Way\b|\bSMPW\b/i, 'PARK WAY'],
  [/\bTagua\s*Life\b|\bCSG\b|\bSAGOCA\b|\bQI\s*\d|\bQNL\b|\bQN\s*\d|\bCLN\b|\bCentral\s*Quadra\b|\bAltos\s*de\s*Taguatinga\b|\bOuro\s*Preto\b|\bSmart\s*Center\b/i, 'TAGUATINGA'],
  [/\bArniqueiras\b/i, 'ARNIQUEIRAS'],
  [/\bSHVP\b|\bConjunto\s*SHA\b/i, 'VICENTE PIRES'],
  [/\bSAAN\b/i, 'SAAN'],
  [/\bSamambaia\b/i, 'SAMAMBAIA'],
  [/\bSobradinho\b|\bDF-150\b|\bRodovia\s*BR-020\b|\bColina\s*Nova\b|\bVivendas\b|\bRIACHO\s*FUNDO\b/i, 'SOBRADINHO'],
  [/\bLago\s*Norte\b|\bCA\s*\d|\bSetor\s*de\s*Habit/i, 'LAGO NORTE'],
  [/\bLago\s*Sul\b|\bSHS\b/i, 'LAGO SUL'],
  [/\bJardim\s*Bot\b|\bQC\s*\d|\bQMSW\b|\bCCSW\b|\bCLSW\b|\bMorada\s*de\s*Deus\b/i, 'JARDIM BOTANICO'],
  [/\bGuar[aá]\b/i, 'GUARA'],
  [/\bPau\s*Brasil\b|\bVento\s*Serrano\b|\bQuattre\b|\bOceania\b|\bCosta\s*Verde\b|\bCitt[aà]\b|\bDuo\b|\bThomas\b|\bMonte\s*Carlo\b|\bReserva\s*Parque\b|\bSquare\s*Garden\b|\bRiviera\b|\bVia\s*Naturale\b|\bIlha\s*Bela\b|\bAquarius\b|\bLeQuartier\b|\bLe\s*Club\b|\bResidencial\s*Esplanada\b|\bTop\s*Life\b|\bOne\s*Residence\b|\bJulia\s*Apart\b|\bGreen\s*Park\b|\bMilena\s*Baqui\b|\bÁguas\s*de\s*Vitória\b/i, 'AGUAS CLARAS'],
];

function inferRegionFromAddress(address: string, name: string): string {
  const text = `${address} ${name}`;
  for (const [regex, region] of ADDRESS_REGION_RULES) {
    if (regex.test(text)) return region;
  }
  return '';
}

// ─── Main parsing ──────────────────────────────────────────────────────────

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
  } catch (err) {
    console.error('[parse-resale-pdf] extraction failed:', err);
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

  // Phase 1: Collect all property records keyed by item number
  const records = new Map<number, PropertyRecord>();
  let pendingItem: number | null = null;
  let lastItem: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip standalone item numbers (e.g. "1", "21", "72")
    if (/^\d{1,3}$/.test(line)) {
      pendingItem = parseInt(line, 10);
      continue;
    }

    // Skip table headers and decorative lines
    if (isTableHeader(line) || isDecorativeLine(line)) continue;

    // Skip region index blocks (consecutive region names at page boundaries)
    if (isRegionIndexLine(line)) continue;

    // Try to match a record start: "52RQB0767..." or "RQB0767..." or "5RQB0739..."
    const recMatch = line.match(/^(\d+)\s*(RQB\d{3,})\s*(.*)/i) || line.match(/^(RQB\d{3,})\s*(.*)/i);
    if (recMatch) {
      const itemNum = recMatch[1].match(/^RQB/i) ? pendingItem : parseInt(recMatch[1], 10);
      const code = (recMatch[1].match(/^RQB/i) ? recMatch[1] : recMatch[2]).toUpperCase();
      const rest = recMatch[1].match(/^RQB/i) ? recMatch[2] : recMatch[3] || '';
      pendingItem = null;

      if (itemNum !== null) {
        const rec = new PropertyRecord(itemNum, code);
        if (rest.trim()) {
          rec.feedConcatenated(rest);
        } else {
          // Code alone on line — next line has name+typology+area+address
          rec._needsConcatenatedNextLine = true;
        }
        records.set(itemNum, rec);
        lastItem = itemNum;
      }
      continue;
    }

    // Feed subsequent lines to the current record
    if (lastItem !== null && records.has(lastItem)) {
      const rec = records.get(lastItem)!;
      if (rec._needsConcatenatedNextLine) {
        rec.feedConcatenated(line);
        rec._needsConcatenatedNextLine = false;
      } else {
        rec.feedLine(line);
      }
    }
  }

  console.log('[parse-resale-pdf] Parsed', records.size, 'records, items:',
    [...records.keys()].sort((a, b) => a - b).join(','));

  // Phase 2: Deduplication — keep last occurrence when same code appears at different items
  const codeToItems = new Map<string, number[]>();
  for (const [item, rec] of records) {
    const items = codeToItems.get(rec.code) || [];
    items.push(item);
    codeToItems.set(rec.code, items);
  }
  for (const [code, items] of codeToItems) {
    if (items.length > 1) {
      const keepItem = Math.max(...items);
      for (const removeItem of items) {
        if (removeItem !== keepItem) {
          records.delete(removeItem);
          console.log(`[parse-resale-pdf] Dedup: ${code} items ${items.join(',')} → keeping ${keepItem}`);
        }
      }
    }
  }

  // Phase 3: Build final sorted array with regions
  const sortedItems = [...records.keys()].sort((a, b) => a - b);
  const properties: ParsedProperty[] = sortedItems.map((item, idx) => {
    const rec = records.get(item)!;
    const region = rec.region || inferRegionFromAddress(rec.address, rec.name);
    return rec.toParsedProperty(idx, region);
  });

  console.log('[parse-resale-pdf] Final:', properties.length, 'properties');
  return properties;
}

// ─── Property record accumulator ───────────────────────────────────────────

/**
 * Accumulates parsed fields for a single property record.
 * The PDF has two line formats for the initial property data:
 *   1. Multi-line: "1\nRQB0777Life Resort\n1 QUARTO\n31 m²Setor SHTN..."
 *   2. Concatenated: "5RQB0739Golden Office Corporate\nSALA\n24 m²Quadra SGAN..."
 *
 * feedConcatenated() handles the rest of the RQB line (the first line after the code),
 * which may contain the property name, and sometimes also typology+area+address all mixed.
 * feedLine() handles subsequent lines in the property block.
 */
class PropertyRecord {
  item: number;
  code: string;
  name = '';
  typology = '';
  bedrooms: number | null = null;
  area: number | null = null;
  address = '';
  captor = '';
  appointment = '';
  phone = '';
  phoneDigits = '';
  price: number | null = null;
  condo: number | null = null;
  iptu: number | null = null;
  notes = '';
  url = '';
  region = '';
  dataNote = '';

  private _priceFound = false;
  private _condoFound = false;
  private _iptuFound = false;
  private _typologyFound = false;
  private _areaFound = false;
  private _addressFound = false;
  private _captorFound = false;
  private _phoneFound = false;
  private _urlFound = false;
  private _nameFound = false;
  _needsConcatenatedNextLine = false;

  constructor(item: number, code: string) {
    this.item = item;
    this.code = code;
  }

  /**
   * Parse the rest of the first line (after RQB code).
   * Examples:
   *   "Life Resort"                           → name only
   *   "Golden Office Corporate"               → name only
   *   "Brasília Shopping"                      → name only
   *   "Edifício Marianna"                      → name only
   *   ""                                       → nothing (name on next line)
   *   "Boulevard Antares I1 QUARTO 30 m²..."  → name + typology + area + address mixed
   *   "Parque das Palmeiras2 QUARTOS71 m²..."  → name + typology + area + address mixed
   *   "Casa SHA2 QUARTOS 130 m²Conjunto SHA..." → "Casa SHA" is name, then rest
   */
  feedConcatenated(text: string) {
    if (!text || !text.trim()) return;
    text = text.trim();

    // Try to split at known boundaries: typology pattern, then area pattern
    // Pattern: everything before typology/area is the name

    // Try splitting at "\d+ QUARTO" (e.g. "Parque das Palmeiras2 QUARTOS")
    // Use [1-9] to avoid matching address numbers like "107" in "SQS 1073 QUARTOS"
    const quartoSplit = text.match(/^(.+?)([1-9])\s*(QUARTO|QUARTOS|SU[IÍ]TES?)(.*)/i);
    if (quartoSplit) {
      const namePart = quartoSplit[1].trim();
      const bedrooms = parseInt(quartoSplit[2], 10);
      // Sanity: if the name part looks like an address (contains SQS, SQN etc.),
      // this isn't a real name+typology split — it's address+typology concatenated
      const isAddressLike = /\bSQS\b|\bSQN\b|\bSHIN\b|\bSHIS\b|\bSCN\b|\bSCS\b/i.test(namePart);
      if (namePart && !isAddressLike && !/\d{3,}|R\$|m[²2]/.test(namePart)) {
        this.name = namePart;
        this._nameFound = true;
      }
      if (!isAddressLike) {
        // Parse the typology part
        const typologyStr = quartoSplit[2] + ' ' + quartoSplit[3];
        this.typology = typologyStr.toUpperCase().trim();
        this.bedrooms = bedrooms;
        this._typologyFound = true;
        // Parse the rest (may contain area + address)
        const rest = (quartoSplit[4] || '').trim();
        if (rest) this.parseAreaAndAddress(rest);
        return;
      }
      // Fall through: address+typology case — treat namePart as address, extract typology
      if (namePart) { this.address = namePart; this._addressFound = true; }
      const typologyStr = quartoSplit[2] + ' ' + quartoSplit[3];
      this.typology = typologyStr.toUpperCase().trim();
      this.bedrooms = bedrooms;
      this._typologyFound = true;
      const rest = (quartoSplit[4] || '').trim();
      if (rest) this.parseAreaAndAddress(rest);
      return;
    }

    // Try splitting at non-digit typology (SALA, LOJA, CASA, etc.)
    const typoSplit = text.match(/^(.+?)(SALA(?:\s+COMERCIAL)?|LOJA(?:\s+COMERCIAL)?|GALP[AÃO]|LOTE\s*H[ií]BRIDO|LOTE|STUDIO|KITNET|FLAT|CASA)(.*)/i);
    if (typoSplit) {
      const namePart = typoSplit[1].trim();
      // Allow names with numbers (e.g. "Office 300", "Edificio Central Park 3")
      if (namePart && !/R\$|m[²2]/.test(namePart) && namePart.length > 2) {
        this.name = namePart;
        this._nameFound = true;
      }
      this.typology = typoSplit[2].toUpperCase().trim();
      this._typologyFound = true;
      const rest = (typoSplit[3] || '').trim();
      if (rest) this.parseAreaAndAddress(rest);
      return;
    }

    // Try splitting at area pattern (e.g. "Brasília Shopping" — no typology on this line)
    const areaSplit = text.match(/^(.+?)([\d.,]+\s*m[²2])(.*)/);
    if (areaSplit) {
      const namePart = areaSplit[1].trim();
      if (namePart && !/\d{3,}|R\$/.test(namePart)) {
        this.name = namePart;
        this._nameFound = true;
      }
      this.parseAreaAndAddress(areaSplit[2] + (areaSplit[3] || ''));
      return;
    }

    // Try: starts with typology only (no name), e.g. "GALPÃO", "GALPÃO-1200 m²..."
    const typoOnly = text.match(/^(GALP[AÃO]|LOTE|SALA|LOJA|STUDIO|KITNET|FLAT)(.*)/i);
    if (typoOnly && !this._nameFound) {
      this.name = typoOnly[1].trim();
      this.typology = typoOnly[1].toUpperCase().trim();
      this._nameFound = true;
      this._typologyFound = true;
      const rest = (typoOnly[2] || '').trim().replace(/^-/, ''); // remove leading dash
      if (rest) this.parseAreaAndAddress(rest);
      return;
    }

    // No special pattern found — the whole thing is the name
    if (text.length > 1 && text.length < 100 && !/R\$|m[²2]/.test(text)) {
      this.name = text;
      this._nameFound = true;
    }
  }

  /**
   * Parse area and address from a string like "30 m²Avenida Pau BrasilLorrany Rodrigues"
   * or "49 m²" or "24 m²Quadra SGAN 915 Módulo G 207"
   */
  private parseAreaAndAddress(text: string) {
    text = text.trim();
    if (!text) return;

    // If typology not found yet, check if text starts with typology pattern
    if (!this._typologyFound) {
      // "4 QUARTOS183 m²..." → extract typology first
      const typoAtStart = text.match(/^(\d+\s*QUARTO|\d+\s*QUARTOS|\d+\s*SU[IÍ]TES?)(.*)/i);
      if (typoAtStart) {
        this.typology = typoAtStart[1].toUpperCase().trim();
        const bedMatch = typoAtStart[1].match(/(\d+)/);
        if (bedMatch) this.bedrooms = parseInt(bedMatch[1], 10);
        this._typologyFound = true;
        text = (typoAtStart[2] || '').trim();
      }
    }

    // Extract area (with decimal comma like 61,80)
    // Also handle m³ typo in PDF (e.g. "138,60 m³" should be treated as m²)
    if (!this._areaFound) {
      const areaMatch = text.match(/(\d+[.,]?\d*)\s*m[²2³3]/);
      if (areaMatch) {
        if (areaMatch[0].includes('m³') || areaMatch[0].includes('m3')) {
          this.dataNote = (this.dataNote ? this.dataNote + '; ' : '') + 'PDF usa m³ ao inves de m²';
        }
        const val = parseBrlNumber(areaMatch[1]);
        if (val !== null && val > 0) {
          this.area = val;
          this._areaFound = true;
          const after = text.substring(areaMatch.index! + areaMatch[0].length).trim();
          if (after.length > 3 && !this._addressFound) {
            this.address = this.extractAddressFromMixed(after);
            if (this.address) this._addressFound = true;
          }
          return;
        }
      }
    }

    // No area found, treat as address
    if (!this._addressFound && text.length > 3) {
      this.address = this.extractAddressFromMixed(text);
      if (this.address) this._addressFound = true;
    }
  }

  /**
   * Given a mixed string like "Quadra SGAN 915 Módulo G 207Gabriel (Eq. Nilton)",
   * extract the address part (before the captor name).
   * Heuristic: address contains address keywords, captor is a person name.
   */
  private extractAddressFromMixed(text: string): string {
    // Try to split at a person-name boundary
    // Person name pattern: starts with uppercase, has space, second word also uppercase
    const personSplit = text.match(/^(.+?)([A-ZÀ-Ú][a-zà-ú]+\s+[A-ZÀ-Ú][a-zà-ú]+)/);
    if (personSplit) {
      const addrPart = personSplit[1].trim();
      const personPart = personSplit[2].trim();
      if (addrPart.length > 3) {
        // If address part looks like an address, use it
        if (/(?:Setor|Quadra|Rua|Avenida|SQN|SQS|SHIN|SHIS|Trecho|Conjunto|Rodovia|SCN|SCS|SMPW|SHVP|SGAN|SHTN|SHN|SEPN|CLN|SIG|CSG|SAGOCA|QI|QN|QMSW|CCSW|CLSW|SAAN|CA\s*\d)/i.test(addrPart)) {
          if (!this._captorFound && personPart.length > 3) {
            this.captor = personPart;
            this._captorFound = true;
          }
          return addrPart;
        }
      }
    }
    return text;
  }

  /**
   * Feed a subsequent line (after the first RQB line) to this property record.
   */
  feedLine(line: string) {
    if (!line || line.length < 2) return;
    const trimmed = line.trim();

    // URL detection
    if (!this._urlFound) {
      const urlMatch = trimmed.match(/(https?:\/\/[^\s]+)/);
      if (urlMatch) { this.url = urlMatch[1]; this._urlFound = true; return; }
    }

    // Phone detection (before price, since price lines can contain numbers)
    if (!this._phoneFound) {
      const phoneMatch = trimmed.match(/(\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4})/);
      if (phoneMatch) {
        this.phone = phoneMatch[1];
        this.phoneDigits = normalizePhoneDigits(phoneMatch[1]);
        this._phoneFound = true;
        return;
      }
    }

    // Appointment detection
    if (!this.appointment && /agend/i.test(trimmed)) {
      this.appointment = trimmed;
      return;
    }

    // Price/condo/iptu line
    if (!this._priceFound || !this._condoFound || !this._iptuFound) {
      if (this.tryParsePriceLine(trimmed)) return;
    }

    // Typology detection (only if not found yet)
    if (!this._typologyFound) {
      // Digit-first: "3 QUARTOS"
      const typoMatch = trimmed.match(/^(\d+)\s*(QUARTO|QUARTOS|SU[IÍ]TES?)/i);
      if (typoMatch) {
        this.typology = typoMatch[1].trim() + ' ' + typoMatch[2].trim().toUpperCase();
        this.bedrooms = parseInt(typoMatch[1], 10);
        this._typologyFound = true;
        return;
      }
      // Non-digit: "SALA", "LOJA", etc.
      const typoNoDigit = trimmed.match(/^(SALA(?:\s+COMERCIAL)?|LOJA(?:\s+COMERCIAL)?|GALP[AÃO]|LOTE\s*H[ií]BRIDO|LOTE|STUDIO|KITNET|FLAT|CASA)/i);
      if (typoNoDigit) {
        this.typology = typoNoDigit[1].toUpperCase().trim();
        this._typologyFound = true;
        return;
      }
    }

    // Area detection
    if (!this._areaFound) {
      const areaMatch = trimmed.match(/([\d.,]+)\s*m[²2]/);
      if (areaMatch) {
        const val = parseBrlNumber(areaMatch[1]);
        if (val !== null && val > 0) {
          this.area = val;
          this._areaFound = true;
          const after = trimmed.substring(areaMatch.index! + areaMatch[0].length).trim();
          if (after.length > 3 && !this._addressFound) {
            this.address = this.extractAddressFromMixed(after);
            if (this.address) this._addressFound = true;
          }
          return;
        }
      }
    }

    // Address detection (only if area was already found or line has address keywords)
    if (!this._addressFound && /(?:Rua|Avenida|Av\.?|Trecho|Setor|Quadra|Conjunto|Rodovia|SHIN|SHIS|SQN|SQS|SCN|SCS|CLS|Bloco|SMPW|SHVP|SAAN|SGAN|SHTN|SHN|SEPN|CLN|SIG|CSG|SAGOCA|QI\s*\d|QN\s*\d|CA\s*\d)/i.test(trimmed)) {
      this.address = trimmed;
      this._addressFound = true;
      return;
    }

    // Captor detection
    if (!this._captorFound && /[A-ZÀ-Ú][a-zà-ú]+ [A-ZÀ-Ú][a-zà-ú]+/.test(trimmed)) {
      if (!/agend|\d{3,}|R\$|m[²2]/i.test(trimmed)) {
        this.captor = trimmed;
        this._captorFound = true;
        return;
      }
    }

    // Name detection (if still missing)
    if (!this._nameFound && !this.name && trimmed.length > 3 && trimmed.length < 100) {
      if (!/\d{3,}|R\$|agend|m[²2]|http|^\./i.test(trimmed)) {
        this.name = trimmed;
        this._nameFound = true;
        return;
      }
    }

    // Notes detection
    if (/financiamento|FGTS|escritura|dispon[ií]vel|luz\s+individual|água\s+inclusa/i.test(trimmed)) {
      this.notes = (this.notes + ' ' + trimmed.replace(/^\.\s*/, '')).trim();
      return;
    }
  }

  /**
   * Parse price/condo/iptu from a line.
   */
  private tryParsePriceLine(line: string): boolean {
    // Standard format: "R$ X  R$ Y  R$ Z"
    const standardMatch = line.match(/R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)/);
    if (standardMatch) {
      const vals = [parseBrlNumber(standardMatch[1]), parseBrlNumber(standardMatch[2]), parseBrlNumber(standardMatch[3])];
      vals.sort((a, b) => (b || 0) - (a || 0));
      if (!this._priceFound && vals[0] !== null) { this.price = vals[0]; this._priceFound = true; }
      if (!this._condoFound && vals[2] !== null) { this.condo = vals[2]; this._condoFound = true; }
      if (!this._iptuFound && vals[1] !== null) { this.iptu = vals[1]; this._iptuFound = true; }
      const after = line.substring(standardMatch.index! + standardMatch[0].length).trim();
      if (after.length > 1) this.notes = (this.notes + ' ' + after.replace(/^\.\s*/, '')).trim();
      return true;
    }

    // 2 R$ values
    const twoR = line.match(/R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)/);
    if (twoR && !line.match(/R\$.*R\$.*R\$/)) {
      const v1 = parseBrlNumber(twoR[1]);
      const v2 = parseBrlNumber(twoR[2]);
      if (v1 !== null && v2 !== null) {
        const [large, small] = v1 > v2 ? [v1, v2] : [v2, v1];
        if (!this._priceFound && large > 1000) { this.price = large; this._priceFound = true; }
        if (!this._condoFound) { this.condo = small; this._condoFound = true; }
      }
      return true;
    }

    // Reversed format: "390.000,00R$ R$ 580,00R$ 445,00"
    const reversedMatch = line.match(/^([\d]{1,3}(?:\.[\d]{3})*,[\d]{2})R\$(?:\s*R\$\s*([\d.,]+))?(?:\s*R\$\s*([\d.,]+))?/);
    if (reversedMatch) {
      const vals = [parseBrlNumber(reversedMatch[1])];
      if (reversedMatch[2]) vals.push(parseBrlNumber(reversedMatch[2]));
      if (reversedMatch[3]) vals.push(parseBrlNumber(reversedMatch[3]));
      const validVals = (vals.filter(v => v !== null) as number[]).sort((a, b) => b - a);
      if (validVals.length >= 1 && !this._priceFound) { this.price = validVals[0]; this._priceFound = true; }
      if (validVals.length >= 2 && !this._condoFound) { this.condo = validVals[validVals.length - 1]; this._condoFound = true; }
      if (validVals.length >= 3 && !this._iptuFound) { this.iptu = validVals[1]; this._iptuFound = true; }
      return true;
    }

    // Standalone "R$ X"
    if (!this._priceFound) {
      const simpleMatch = line.match(/^R\$\s*([\d.,]+)/);
      if (simpleMatch) {
        const val = parseBrlNumber(simpleMatch[1]);
        if (val !== null && val > 1000) { this.price = val; this._priceFound = true; return true; }
      }
    }

    return false;
  }

  toParsedProperty(orderIdx: number, region: string): ParsedProperty {
    const name = this.name.trim();
    const notes = this.notes.trim();
    const typology = this.typology.trim();
    const category = categorize(typology, name, this.url);
    // Normalize accented region names to match seed data conventions
    const normalizedRegion = region
      .replace(/^AGUAS CLARAS$/, 'ÁGUAS CLARAS')
      .replace(/^JARDIM BOTANICO$/, 'JARDIM BOTÂNICO');
    return {
      sortOrder: this.item,
      code: this.code,
      name,
      region: normalizedRegion,
      category,
      typology,
      bedrooms: this.bedrooms,
      area: this.area,
      address: this.address.trim(),
      captor: this.captor.trim(),
      appointment: this.appointment.trim(),
      phone: this.phone.trim(),
      phoneDigits: this.phoneDigits,
      price: this.price,
      condo: this.condo,
      iptu: this.iptu,
      notes,
      acceptsFinancing: checkFinancing(notes),
      acceptsFgts: checkFgts(notes),
      url: this.url,
      dataNote: this.dataNote.trim(),
      sourcePage: undefined,
    };
  }
}

// ─── Line classification ───────────────────────────────────────────────────

function isTableHeader(line: string): boolean {
  const u = line.toUpperCase().trim();
  if (u === 'ITEM' || u === 'CODIGO' || u === 'CÓDIGO' || u === 'INFORCE') return true;
  if (u.startsWith('NOME DO EMPREENDIMENTO') || u.startsWith('(CLIQUE PARA')) return true;
  if (u === 'TIPOLOGIA' || u.startsWith('AREA') || u.includes('PRIVATIVA')) return true;
  if (u === 'ENDEREÇO' || u === 'ENDERECO' || u.startsWith('CAPTADOR')) return true;
  if (u.startsWith('AGENDAR VISITA') || u.startsWith('VALOR DE VENDA')) return true;
  if (u.startsWith('INFORMA') || u.startsWith('CONDOMÍNIO') || u.startsWith('CONDOMINIO')) return true;
  if (u.startsWith('ATUALIZADO')) return true;
  return false;
}

function isDecorativeLine(line: string): boolean {
  return /^[\-_\=\s]+$/.test(line) && line.length > 5;
}

function isRegionIndexLine(line: string): boolean {
  const upper = line.toUpperCase().trim();
  if (upper.length === 0 || upper.length > 35) return false;
  if (/\d/.test(upper) && !/ASA\s*NORTE|SUDOESTE|NOROESTE|LESTE|OESTE|\bI\b|\bII\b|\bIII\b/i.test(upper)) return false;
  for (const kw of REGION_KEYWORDS) {
    if (upper === kw || upper.startsWith(kw + ' ')) return true;
  }
  return false;
}

// ─── Utility functions ─────────────────────────────────────────────────────

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
      /\d+\s*QUARTO/i.test(tu)) return 'Apartamento';
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