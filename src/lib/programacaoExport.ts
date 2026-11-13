import type { OPStep, RawOP } from './productionLogic';

// A exportação usa somente as etapas exibidas no painel; não recalcula a programação.
export const PROGRAMACAO_EXPORT_HEADERS = [
  'SÉRIE', 'POTÊNCIA', 'OP', 'REFERÊNCIA', 'LINHA', 'CLIENTE', 'DATA PROG.', 'SETOR',
] as const;

export type ProgramacaoExportRow = [string, string, string, string, string, string, string, string];

const sourceKey = (op: Pick<RawOP, 'op' | 'linha' | 'data_mf' | 'qtd_mf'>) =>
  `${op.op.trim()}|${op.linha.trim().toUpperCase()}|${op.data_mf}|${op.qtd_mf}`;

const getSeries = (op: RawOP): string[] => {
  // Sem número de série, mantém uma linha por peça programada e deixa SÉRIE em branco.
  // Não deduzir séries inexistentes nem bloquear a exportação por dados incompletos.
  const quantity = Number.isSafeInteger(op.qtd_mf) && op.qtd_mf > 0 ? op.qtd_mf : 1;
  const blankSeries = () => Array.from({ length: quantity }, () => '');

  const explicit = String(op.serie ?? '').trim();
  if (explicit) {
    const series = explicit.split(/[;,\n]+/).map(value => value.trim()).filter(Boolean);
    return Array.from({ length: quantity }, (_, index) => series[index] ?? '');
  }

  const start = String(op.serieInicial ?? '').trim();
  const end = String(op.serieFinal ?? '').trim();
  if (!/^\d+$/.test(start) || !/^\d+$/.test(end)) return blankSeries();

  const startNumber = Number(start);
  const endNumber = Number(end);
  if (!Number.isSafeInteger(startNumber) || !Number.isSafeInteger(endNumber) || endNumber - startNumber + 1 !== quantity) {
    return blankSeries();
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
    // Dados de origem podem ter sido importados antes da funcionalidade de exportação.
    // Mesmo sem o registro original, a etapa exibida deve ser exportável.
    const matching: RawOP[] = sources.get(sourceKey(step)) ?? [{
      op: step.op, linha: step.linha, data_mf: step.data_mf, qtd_mf: step.qtd_mf,
    }];
    for (const original of matching) {
      const potencia = String(original.potencia ?? '').trim();
      const referencia = String(original.referencia ?? '').trim();
      const cliente = String(original.cliente ?? '').trim();
      for (const serie of getSeries(original)) {
        // Séries vazias não podem ser deduplicadas: cada uma representa uma peça.
        if (serie) {
          const uniqueKey = `${original.op}|${step.stepName}|${serie}`;
          const previousDate = seenSeriesPerSector.get(uniqueKey);
          if (previousDate) {
            if (previousDate !== step.usedDate) {
              throw new Error(`OP ${original.op}: a série ${serie} aparece em duas datas no setor ${step.stepName}. Corrija a programação antes de exportar.`);
            }
            continue; // Mesmo registro de série/setor/data: exportar somente uma vez.
          }
          seenSeriesPerSector.set(uniqueKey, step.usedDate);
        }
        results.push([serie, potencia, original.op, referencia, step.linha, cliente, step.usedDate, step.stepName]);
      }
    }
  }
  return results;
}
