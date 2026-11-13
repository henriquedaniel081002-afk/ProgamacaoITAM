// Metadados complementares da importação "Status das OPs".
// Mantidos em armazenamento separado para não alterar o comportamento dos status.
export interface OpSerialRange {
  inicial: string;
  final: string;
}

export interface OpStatusDetails {
  cliente: string;
  potencia: string;
  linha: string;
  referencia: string;
  faixas: OpSerialRange[];
}

export type OpStatusDetailsByOp = Record<string, OpStatusDetails>;

const cellText = (value: unknown): string => String(value ?? '').trim();

// O arquivo de status mantém cabeçalhos na 3ª linha. Índices são baseados em zero:
// B=OP, C=Cliente, D/E=Séries, F=Potência, G=Linha, H=Referência e J=Status.
export function appendStatusDetails(byOp: OpStatusDetailsByOp, op: string, row: unknown[]): void {
  const current = byOp[op] ?? {
    cliente: '', potencia: '', linha: '', referencia: '', faixas: [],
  };
  current.cliente ||= cellText(row[2]);
  current.potencia ||= cellText(row[5]);
  current.linha ||= cellText(row[6]);
  current.referencia ||= cellText(row[7]);

  const inicial = cellText(row[3]);
  const final = cellText(row[4]);
  if (inicial && final &&
      !current.faixas.some(range => range.inicial === inicial && range.final === final)) {
    current.faixas.push({ inicial, final });
  }
  byOp[op] = current;
}

function numericSerial(value: string): { numero: number; width: number } | null {
  const match = /^\s*[A-Za-z]*\s*(\d+)\s*$/.exec(value);
  if (!match) return null;
  const numero = Number(match[1]);
  return Number.isSafeInteger(numero) ? { numero, width: match[1].length } : null;
}

// Retira as letras das séries, preserva zeros à esquerda e ignora faixas inválidas.
// Não inventa séries quando o relatório está incompleto.
export function expandStatusSerials(details: OpStatusDetails | undefined, maxCount: number): string[] {
  if (!details || maxCount <= 0) return [];
  const intervals = (details.faixas ?? []).flatMap(({ inicial, final }) => {
    const first = numericSerial(inicial);
    const last = numericSerial(final);
    if (!first || !last || first.numero > last.numero ||
        last.numero - first.numero > 100000) return [];
    return [{ start: first.numero, end: last.numero, width: Math.max(first.width, last.width) }];
  }).sort((a, b) => a.start - b.start || a.end - b.end);

  const series: string[] = [];
  const seen = new Set<number>();
  for (const interval of intervals) {
    for (let number = interval.start; number <= interval.end && series.length < maxCount; number++) {
      if (!seen.has(number)) {
        seen.add(number);
        series.push(String(number).padStart(interval.width, '0'));
      }
    }
    if (series.length >= maxCount) break;
  }
  return series;
}

export function normalizeOpForExport(value: string): string {
  return String(value ?? '').replace(/\s+/g, '').replace(/\.0+$/, '').replace(/[^0-9]/g, '');
}
