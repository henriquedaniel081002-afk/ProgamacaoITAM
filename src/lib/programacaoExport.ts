import type { OPStep, RawOP } from './productionLogic';
import { expandStatusSerials, normalizeOpForExport } from './opStatusDetails';
import type { OpStatusDetailsByOp } from './opStatusDetails';

// A exportação usa somente as etapas exibidas no painel; não recalcula a programação.
export const PROGRAMACAO_EXPORT_HEADERS = [
  'SÉRIE', 'POTÊNCIA', 'OP', 'REFERÊNCIA', 'LINHA', 'CLIENTE', 'DATA PROG.', 'SETOR',
] as const;

export type ProgramacaoExportRow = [string, string, string, string, string, string, string, string];

// Nomenclaturas exigidas pela base de apontamento/produção (somente exportação).
// A etapa interna "Pintura Ferragem" não integra essa relação: PINTURA é a
// etapa Pintura Tanque (1 dia útil antes da Montagem Final).
export const EXPORT_SECTOR_NAMES: Readonly<Record<string, string>> = {
  'Montagem Final': 'MONTAGEM FINAL',
  'Montagem Núcleo': 'MONTAGEM DO NUCLEO',
  'Bobinagem AT': 'BOBINA AT',
  'Pintura Tanque': 'PINTURA',
  'MPA': 'MPA',
  'Ferragem': 'FERRAGEM',
  'Isolante': 'ISOLANTE',
  'Bobinagem BT': 'BOBINA BT',
  'Solda Tanque': 'SOLDA',
  'Corte Núcleo': 'CORTE DO NUCLEO',
  'Estamparia': 'CORTE DO LASER',
  'Bobinagem Epoxi': 'BOBINAGEM EPOXI',
  'Encapsulamento': 'ENCAPSULAMENTO',
};


const sourceKey = (op: Pick<RawOP, 'op' | 'linha' | 'data_mf' | 'qtd_mf'>) =>
  `${op.op.trim()}|${op.linha.trim().toUpperCase()}|${op.data_mf}|${op.qtd_mf}`;

const seriesWithoutPrefix = (value: string): string => {
  const match = /^\s*[A-Za-z]*\s*(\d+)\s*$/.exec(String(value ?? ''));
  return match?.[1] ?? '';
};

const getSeries = (op: RawOP): string[] => {
  const quantity = Number.isSafeInteger(op.qtd_mf) && op.qtd_mf > 0 ? op.qtd_mf : 1;
  const empty = () => Array.from({ length: quantity }, () => '');
  const explicit = String(op.serie ?? '').trim();
  if (explicit) {
    const values = explicit.split(/[;,\n]+/).map(value => seriesWithoutPrefix(value));
    return Array.from({ length: quantity }, (_, index) => values[index] ?? '');
  }
  const start = seriesWithoutPrefix(String(op.serieInicial ?? ''));
  const end = seriesWithoutPrefix(String(op.serieFinal ?? ''));
  if (!start || !end) return empty();
  const first = Number(start);
  const last = Number(end);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first + 1 !== quantity) {
    return empty();
  }
  const width = Math.max(start.length, end.length);
  return Array.from({ length: quantity }, (_, index) => String(first + index).padStart(width, '0'));
};

export function buildProgramacaoExportRows(
  visibleSteps: OPStep[],
  rawOPs: RawOP[],
  statusDetailsByOp: OpStatusDetailsByOp = {},
): ProgramacaoExportRow[] {
  if (visibleSteps.length === 0) throw new Error('Não há programação exibida para exportar. Ajuste os filtros.');

  // Calcula as posições das séries por lote da OP em TODA a programação,
  // antes dos filtros. Assim o filtro de data/setor não reinicia a numeração.
  const sources = new Map<string, RawOP>();
  const batchesByOp = new Map<string, RawOP[]>();
  for (const rawOP of rawOPs) {
    const key = sourceKey(rawOP);
    if (sources.has(key)) continue;
    sources.set(key, rawOP);
    const op = normalizeOpForExport(rawOP.op);
    const batches = batchesByOp.get(op) ?? [];
    batches.push(rawOP);
    batchesByOp.set(op, batches);
  }

  const startingIndexByBatch = new Map<string, number>();
  const statusSerialsByOp = new Map<string, string[]>();
  for (const [op, batches] of batchesByOp) {
    batches.sort((a, b) => a.data_mf.localeCompare(b.data_mf) ||
      a.linha.localeCompare(b.linha) || a.qtd_mf - b.qtd_mf);
    let totalQuantity = 0;
    for (const batch of batches) {
      startingIndexByBatch.set(sourceKey(batch), totalQuantity);
      if (Number.isSafeInteger(batch.qtd_mf) && batch.qtd_mf > 0) totalQuantity += batch.qtd_mf;
    }
    statusSerialsByOp.set(op, expandStatusSerials(statusDetailsByOp[op], totalQuantity));
  }

  const orderedSteps = [...visibleSteps].sort((a, b) =>
    a.usedDate.localeCompare(b.usedDate) ||
    a.op.localeCompare(b.op, 'pt-BR', { numeric: true }) ||
    a.stepName.localeCompare(b.stepName, 'pt-BR')
  );
  const results: ProgramacaoExportRow[] = [];
  const seenSeriesPerSector = new Map<string, string>();

  for (const step of orderedSteps) {
    const exportSector = EXPORT_SECTOR_NAMES[step.stepName];
    if (!exportSector) continue;
    const opKey = normalizeOpForExport(step.op);
    const original: RawOP = sources.get(sourceKey(step)) ?? {
      op: step.op, linha: step.linha, data_mf: step.data_mf, qtd_mf: step.qtd_mf,
    };
    const details = statusDetailsByOp[opKey];
    const potencia = String(original.potencia || details?.potencia || '').trim();
    const referencia = String(original.referencia || details?.referencia || '').trim();
    const cliente = String(original.cliente || details?.cliente || '').trim();
    const quantity = Number.isSafeInteger(step.qtd_mf) && step.qtd_mf > 0 ? step.qtd_mf : 1;
    const statusSeries = statusSerialsByOp.get(opKey) ??
      expandStatusSerials(details, quantity);
    const offset = startingIndexByBatch.get(sourceKey(step)) ?? 0;
    const originalSeries = getSeries(original);

    for (let index = 0; index < quantity; index++) {
      // Faixas do Status das OPs têm prioridade; o Excel original é fallback.
      const serie = statusSeries[offset + index] || originalSeries[index] || '';
      if (serie) {
        const uniqueKey = `${opKey}|${exportSector}|${serie}`;
        const previousDate = seenSeriesPerSector.get(uniqueKey);
        if (previousDate) {
          if (previousDate !== step.usedDate) {
            throw new Error(`OP ${step.op}: a série ${serie} aparece em duas datas no setor ${step.stepName}.`);
          }
          continue;
        }
        seenSeriesPerSector.set(uniqueKey, step.usedDate);
      }
      results.push([serie, potencia, step.op, referencia, step.linha, cliente, step.usedDate, exportSector]);
    }
  }
  if (results.length === 0) throw new Error('Nenhum setor da programação filtrada corresponde às nomenclaturas configuradas para exportação.');
  return results;
}
