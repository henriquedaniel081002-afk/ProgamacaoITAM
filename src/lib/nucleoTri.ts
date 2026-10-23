import * as XLSX from 'xlsx';

/** Programação explícita das células marcadas no calendário "nucleo trif". */
export interface NucleoTriEntry {
  op: string;
  data: string; // AAAA-MM-DD, copiada diretamente do cabeçalho de data do Excel
  quantidade: number;
  modelo: string;
  cliente: string;
}

export interface NucleoTriImport {
  entries: NucleoTriEntry[];
  sheetName: string;
  ignoredWithoutOp: number;
}

function normalizedText(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
}

function normalizedOp(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, '').replace(/\.0+$/, '').replace(/[^0-9]/g, '');
}

function excelCalendarDate(value: unknown): string | null {
  // Ler data de uma coluna SEM subtrair dias úteis nem corrigir fins de semana.
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 100000) {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d || !d.y || !d.m || !d.d) return null;
    return `${String(d.y).padStart(4, '0')}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (br) {
      const date = new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1])));
      if (date.getUTCDate() !== Number(br[1]) || date.getUTCMonth() !== Number(br[2]) - 1) return null;
      return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (iso) {
      const date = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s ? s : null;
    }
  }
  return null;
}

export function parseNucleoTriWorkbook(workbook: XLSX.WorkBook): NucleoTriImport {
  const name = workbook.SheetNames.find(sheet => /NUCLEO.*TRIF|TRIF.*NUCLEO/.test(normalizedText(sheet)));
  if (!name) {
    throw new Error('A planilha precisa conter uma aba de Núcleo Trifásico (ex.: "nucleo trif").');
  }
  const worksheet = workbook.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1, range: 0, raw: true, defval: null, blankrows: true,
  });
  // O cabeçalho é a linha 3: "modelo", "cliente", "OP" e datas nas demais colunas.
  const headers = rows[2];
  if (!headers) throw new Error('O arquivo não possui o cabeçalho na linha 3.');
  const opColumn = headers.findIndex(value => normalizedText(value) === 'OP');
  if (opColumn < 0) throw new Error('Não foi encontrada a coluna OP na linha 3.');
  const modelColumn = headers.findIndex(value => normalizedText(value) === 'MODELO');
  const clientColumn = headers.findIndex(value => normalizedText(value) === 'CLIENTE');
  const dateColumns = headers
    .map((value, column) => ({ column, date: excelCalendarDate(value) }))
    .filter((item): item is { column: number; date: string } => !!item.date && item.column !== opColumn);
  if (dateColumns.length === 0) throw new Error('Não foram encontradas colunas com datas na linha 3.');

  const entries = new Map<string, NucleoTriEntry>();
  let ignoredWithoutOp = 0;
  for (const row of rows.slice(3)) {
    if (!row) continue;
    const marked = dateColumns.flatMap(({ column, date }) => {
      const raw = row[column];
      const quantity = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.').trim());
      return Number.isFinite(quantity) && quantity > 0 ? [{ date, quantity }] : [];
    });
    if (marked.length === 0) continue;
    const op = normalizedOp(row[opColumn]);
    // Linhas sem OP não devem herdar a OP anterior: seriam associações inventadas.
    if (!op) { ignoredWithoutOp++; continue; }
    const modelo = modelColumn >= 0 ? String(row[modelColumn] ?? '').trim() : '';
    const cliente = clientColumn >= 0 ? String(row[clientColumn] ?? '').trim() : '';
    for (const { date, quantity } of marked) {
      const key = `${op}|${date}`;
      const existing = entries.get(key);
      if (existing) existing.quantidade += quantity;
      else entries.set(key, { op, data: date, quantidade: quantity, modelo, cliente });
    }
  }
  if (entries.size === 0) throw new Error('Nenhuma OP com quantidade programada foi encontrada na aba Núcleo Trifásico.');
  return {
    entries: [...entries.values()].sort((a, b) => a.data.localeCompare(b.data) || a.op.localeCompare(b.op, undefined, { numeric: true })),
    sheetName: name,
    ignoredWithoutOp,
  };
}
