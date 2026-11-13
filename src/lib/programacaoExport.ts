import type { OPStep, RawOP } from './productionLogic';

// A exportação usa somente as etapas exibidas no painel; não recalcula a programação.
export const PROGRAMACAO_EXPORT_HEADERS = [
  'SÉRIE', 'POTÊNCIA', 'OP', 'REFERÊNCIA', 'LINHA', 'CLIENTE', 'DATA PROG.', 'SETOR',
] as const;

export type ProgramacaoExportRow = [string, string, string, string, string, string, string, string];

const sourceKey = (op: Pick<RawOP, 'op' | 'linha' | 'data_mf' | 'qtd_mf'>) =>
  `${op.op.trim()}|${op.linha.trim().toUpperCase()}|${op.data_mf}|${op.qtd_mf}`;

const getSeries = (op: RawOP): string[] => {
  const quantity = op.qtd_mf;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error(`OP ${op.op}: quantidade inválida para exportação individual por série.`);
  }

  const explicit = String(op.serie ?? '').trim();
  if (explicit) {
    const series = explicit.split(/[;,\n]+/).map(value => value.trim()).filter(Boolean);
    if (series.length !== quantity || new Set(series).size !== series.length) {
      throw new Error(`OP ${op.op}: a quantidade de séries informadas não corresponde à QTD_MF (${quantity}).`);
    }
    return series;
  }

  const start = String(op.serieInicial ?? '').trim();
  const end = String(op.serieFinal ?? '').trim();
  if (!/^\d+$/.test(start) || !/^\d+$/.test(end)) {
    throw new Error(`OP ${op.op}: faltam SÉRIE ou SÉRIE INICIAL e SÉRIE FINAL no Excel importado. Reimporte a programação com essas colunas para exportar por série.`);
  }

  const startNumber = Number(start);
  const endNumber = Number(end);
  if (!Number.isSafeInteger(startNumber) || !Number.isSafeInteger(endNumber) || endNumber - startNumber + 1 !== quantity) {
    throw new Error(`OP ${op.op}: o intervalo de séries ${start}–${end} não corresponde à QTD_MF (${quantity}).`);
  }
  const width = Math.max(start.length, end.length);
  return Array.from({ length: quantity }, (_, index) => String(startNumber + index).padStart(width, '0'));
};

export function buildProgramacaoExportRows(visibleSteps: OPStep[], rawOPs: RawOP[]): ProgramacaoExportRow[] {
  if (visibleSteps.length === 0) throw new Error('Não há programação exibida para exportar. Ajuste os filtros.');

  const sources = new Map<string, RawOP[]>();
  for (const rawOP of rawOPs) {
    const key = sourceKey(rawOP);
    const group = sources.get(key) ?? [];
    group.push(rawOP);
    sources.set(key, group);
  }

  const orderedSteps = [...visibleSteps].sort((a, b) =>
    a.usedDate.localeCompare(b.usedDate) || a.op.localeCompare(b.op, 'pt-BR', { numeric: true }) || a.stepName.localeCompare(b.stepName, 'pt-BR')
  );
  const results: ProgramacaoExportRow[] = [];
  const seenSeriesPerSector = new Map<string, string>();

  for (const step of orderedSteps) {
    const matching = sources.get(sourceKey(step));
    if (!matching?.length) {
      throw new Error(`OP ${step.op}: não foi possível relacionar a etapa ${step.stepName} ao Excel de origem. Reimporte a programação.`);
    }
    for (const original of matching) {
      const potencia = String(original.potencia ?? '').trim();
      const referencia = String(original.referencia ?? '').trim();
      const cliente = String(original.cliente ?? '').trim();
      if (!potencia || !referencia || !cliente) {
        const missing = [!potencia && 'POTÊNCIA', !referencia && 'REFERÊNCIA', !cliente && 'CLIENTE'].filter(Boolean).join(', ');
        throw new Error(`OP ${original.op}: faltam ${missing} no Excel de origem. Reimporte a programação com esses campos para exportar sem informações incompletas.`);
      }
      for (const serie of getSeries(original)) {
        const uniqueKey = `${original.op}|${step.stepName}|${serie}`;
        const previousDate = seenSeriesPerSector.get(uniqueKey);
        if (previousDate) {
          if (previousDate !== step.usedDate) {
            throw new Error(`OP ${original.op}: a série ${serie} aparece em duas datas no setor ${step.stepName}. Corrija a programação antes de exportar.`);
          }
          continue; // Mesmo registro de série/setor/data: exportar somente uma vez.
        }
        seenSeriesPerSector.set(uniqueKey, step.usedDate);
        results.push([serie, potencia, original.op, referencia, step.linha, cliente, step.usedDate, step.stepName]);
      }
    }
  }
  return results;
}
