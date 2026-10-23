import type { NucleoTriEntry } from './nucleoTri';

/** Validação independente: nunca altera a programação ou a validação da aba principal. */
export type NucleoTriSector = 'Corte Núcleo' | 'Montagem Núcleo';
export type NucleoTriValidationStatus = 'OK' | 'Programado parcial' | 'Não programado' | 'Data divergente' | 'Quantidade divergente' | 'Duplicado' | 'Extra';
export type NucleoTriSankhyaRow = { op: string; data: string; setor: string; qtd: number; linha: string };
export type NucleoTriValidationResult = {
  status: NucleoTriValidationStatus;
  op: string;
  dataPainel?: string;
  dataSistema?: string;
  setor: NucleoTriSector;
  qtdPainel?: number;
  qtdSistema?: number;
  observacao: string;
};

const normOp = (op: string) => String(op ?? '').trim().replace(/\s+/g, '').replace(/\.0+$/, '').replace(/[^0-9]/g, '');
const qty = (value: number) => Math.round(Number(value || 0) * 1000) / 1000;
const sameQty = (a: number, b: number) => qty(a) === qty(b);
const normSector = (name: string) => String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const BR = (date: string) => date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '-';
const statusOrder: Record<NucleoTriValidationStatus, number> = {
  'Não programado': 0, 'Programado parcial': 1, 'Data divergente': 2,
  'Quantidade divergente': 3, Duplicado: 4, Extra: 5, OK: 6,
};

export function validateNucleoTri(
  entries: NucleoTriEntry[],
  sankhyaRows: NucleoTriSankhyaRow[],
  sector: NucleoTriSector,
): NucleoTriValidationResult[] {
  if (!entries.length || !sankhyaRows.length) return [];

  const sectorRows = sankhyaRows.filter(row => normSector(row.setor) === normSector(sector));
  const knownOps = new Set(entries.map(entry => normOp(entry.op)));
  const opRows = new Map<string, NucleoTriSankhyaRow[]>();
  const opDateRows = new Map<string, NucleoTriSankhyaRow[]>();
  const panelKeys = new Set(entries.map(entry => `${normOp(entry.op)}|${entry.data}`));

  for (const row of sectorRows) {
    const op = normOp(row.op);
    const forOp = opRows.get(op) || [];
    forOp.push(row);
    opRows.set(op, forOp);
    const key = `${op}|${row.data}`;
    const forDate = opDateRows.get(key) || [];
    forDate.push(row);
    opDateRows.set(key, forDate);
  }

  const results: NucleoTriValidationResult[] = entries.map(entry => {
    const op = normOp(entry.op);
    const sameOp = opRows.get(op) || [];
    const matches = opDateRows.get(`${op}|${entry.data}`) || [];
    const equalQty = matches.filter(row => sameQty(row.qtd, entry.quantidade));
    const common = {
      op: entry.op, dataPainel: entry.data, setor: sector,
      qtdPainel: entry.quantidade,
    };
    if (equalQty.length > 1) {
      return {
        ...common, status: 'Duplicado', dataSistema: entry.data, qtdSistema: equalQty[0].qtd,
        observacao: `A mesma OP, data, setor e quantidade aparece ${equalQty.length} vezes no Sankhya.`,
      };
    }
    if (equalQty.length === 1) {
      return {
        ...common, status: 'OK', dataSistema: entry.data, qtdSistema: equalQty[0].qtd,
        observacao: 'OP, data, setor e quantidade conferem com o Sankhya.',
      };
    }
    if (matches.length) {
      return {
        ...common, status: 'Quantidade divergente', dataSistema: entry.data, qtdSistema: matches.reduce((sum, row) => sum + row.qtd, 0),
        observacao: `A OP está programada na data correta, mas a quantidade difere. ${matches.length} registro(s) no Sankhya nesta data.`,
      };
    }
    const otherDate = sameOp.find(row => sameQty(row.qtd, entry.quantidade));
    if (otherDate) {
      return {
        ...common, status: 'Data divergente', dataSistema: otherDate.data, qtdSistema: otherDate.qtd,
        observacao: `Mesma OP e quantidade foram encontradas em ${BR(otherDate.data)}, mas o Excel do Núcleo TRI determina ${BR(entry.data)}.`,
      };
    }
    return {
      ...common, status: 'Não programado',
      observacao: sameOp.length
        ? `A OP está no setor ${sector}, mas não há correspondência de data e quantidade. Datas no Sankhya: ${[...new Set(sameOp.map(row => BR(row.data)))].join(', ')}.`
        : `OP não encontrada no setor ${sector} do relatório importado.`,
    };
  });

  // Mesmo critério de parcialidade da aba principal: parte OK e parte não programada para a mesma OP.
  const byOp = new Map<string, NucleoTriValidationResult[]>();
  for (const result of results) {
    const op = normOp(result.op);
    const list = byOp.get(op) || [];
    list.push(result);
    byOp.set(op, list);
  }
  for (const group of byOp.values()) {
    const ok = group.filter(result => result.status === 'OK');
    const missing = group.filter(result => result.status === 'Não programado');
    if (!ok.length || !missing.length) continue;
    const made = ok.reduce((sum, result) => sum + (result.qtdPainel || 0), 0);
    const missingQty = missing.reduce((sum, result) => sum + (result.qtdPainel || 0), 0);
    const dates = missing.map(result => `${BR(result.dataPainel || '')} (${result.qtdPainel})`).join(' | ');
    for (const result of ok) {
      result.status = 'Programado parcial';
      result.observacao = `OP parcialmente programada no Sankhya: ${made} peça(s) conferem; ${missingQty} peça(s) faltam em ${dates}.`;
    }
  }

  // Não incluir como “Extra” as milhares de OPs de outros setores ou fora da planilha do Núcleo TRI.
  for (const [key, rows] of opDateRows) {
    const op = key.split('|')[0];
    if (!knownOps.has(op) || panelKeys.has(key)) continue;
    for (const row of rows) {
      results.push({
        status: 'Extra', op: row.op, dataSistema: row.data, setor: sector,
        qtdSistema: row.qtd,
        observacao: `Registro adicional no Sankhya para uma OP presente no Núcleo TRI, sem programação para ${BR(row.data)} no Excel.`,
      });
    }
  }

  return results.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]
    || a.op.localeCompare(b.op, undefined, { numeric: true })
    || (a.dataPainel || a.dataSistema || '').localeCompare(b.dataPainel || b.dataSistema || ''));
}
