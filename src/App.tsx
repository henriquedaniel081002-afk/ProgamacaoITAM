import React, { useMemo, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Calendar as CalendarIcon, Copy, Check, FlaskConical, X, FileCheck2 } from 'lucide-react';
import { 
  RawOP, 
  OPStep, 
  ValidDaysConfig, 
  PRODUCTION_STEPS, 
  generateStepsForOP, 
  parseExcelDate 
} from './lib/productionLogic';
import { formatToBRLDate } from './lib/utils';
import { CalendarModal } from './components/CalendarModal';
import { FilterBar } from './components/FilterBar';

type SankhyaProgramRow = { op: string; data: string; setor: string; qtd: number; linha: string; };
type ValidationStatus = 'OK' | 'Não programado' | 'Data divergente' | 'Quantidade divergente' | 'Duplicado' | 'Extra';
type ValidationResult = { status: ValidationStatus; op: string; dataPainel?: string; dataSistema?: string; setor: string; qtdPainel?: number; qtdSistema?: number; linhaPainel?: string; linhaSistema?: string; observacao: string; };
type MainValidationInfo = { status: ValidationStatus; dataSistema?: string; observacao: string; };
const ERROR_STATUSES: ValidationStatus[] = ['Não programado', 'Data divergente', 'Quantidade divergente', 'Duplicado', 'Extra'];


const COD_TO_SETOR: Record<string, string> = {
  '2658':'BOBINAGEM AT','2480':'BOBINAGEM AT','2026':'BOBINAGEM AT',
  '2640':'BOBINAGEM BT','2487':'BOBINAGEM BT','2033':'BOBINAGEM BT',
  '2714':'CORTE NUCLEO','2471':'CORTE NUCLEO',
  '2881':'ESTAMPARIA','2829':'ESTAMPARIA',
  '2818':'FERRAGEM',
  '2694':'ISOLANTE',
  '2701':'Montagem Final','2436':'Montagem Final','2198':'Montagem Final','2187':'Montagem Final',
  '2716':'MONTAGEM NUCLEO','2473':'MONTAGEM NUCLEO',
  '2855':'MPA','2460':'MPA',
  '2819':'Pintura Ferragem','2512':'Pintura Ferragem',
  '2885':'Pintura Tanque','2833':'Pintura Tanque',
  '2883':'Solda Tanque','2831':'Solda Tanque'
};

const normalizeSankhyaCod = (cod: any) =>
  String(cod ?? '')
    .trim()
    .replace(/\.0+$/, '')
    .replace(/[^0-9]/g, '');

const mapCodToSetor = (cod: any, fallback: string) => {
  const key = normalizeSankhyaCod(cod);
  return COD_TO_SETOR[key] || fallback;
};

export default function App() {
  const [validDaysConfig, setValidDaysConfig] = useState<ValidDaysConfig>({
    invalidDays: [],
    extraValidDays: []
  });
  
  const [rawOPs, setRawOPs] = useState<RawOP[]>([]);
  const [calculatedSteps, setCalculatedSteps] = useState<OPStep[]>([]);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testMfDate, setTestMfDate] = useState('');
  const [testSteps, setTestSteps] = useState<OPStep[]>([]);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  // Somente a última linha copiada fica destacada.
  // Ao copiar outra OP ou QTD, a linha anterior desmarca automaticamente.
  const [copiedRowKey, setCopiedRowKey] = useState<string | null>(null);

  const [errorInfo, setErrorInfo] = useState<string | null>(null);
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [sankhyaRows, setSankhyaRows] = useState<SankhyaProgramRow[]>([]);
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const validationFileInputRef = useRef<HTMLInputElement>(null);

  const [filters, setFilters] = useState({
    dateStart: '',
    dateEnd: '',
    sector: '',
    linha: '',
    op: ''
  });


  const normalizeHeader = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

  const getCellValue = (row: Record<string, any>, aliases: string[]) => {
    const normalizedAliases = aliases.map(normalizeHeader);
    const foundKey = Object.keys(row).find(key => normalizedAliases.includes(normalizeHeader(key)));
    return foundKey ? row[foundKey] : undefined;
  };

  const getCellFromRowArray = (headers: any[], row: any[], aliases: string[]) => {
    // Prioriza a ordem dos aliases. Isso evita pegar "Atividade" (código)
    // antes de "Descrição (Atividade)" (setor correto) quando as duas colunas existem.
    for (const alias of aliases) {
      const normalizedAlias = normalizeHeader(alias);
      const foundIndex = headers.findIndex(header => normalizeHeader(String(header ?? '')) === normalizedAlias);
      if (foundIndex >= 0) return row[foundIndex];
    }
    return undefined;
  };

  const rowHasAnyAlias = (headers: any[], aliases: string[]) => {
    const normalizedAliases = aliases.map(normalizeHeader);
    return headers.some(header => normalizedAliases.includes(normalizeHeader(String(header ?? ''))));
  };

  const findHeaderRowIndex = (rows: any[][], requiredAliasGroups: string[][]) => {
    return rows.findIndex(row => requiredAliasGroups.every(group => rowHasAnyAlias(row, group)));
  };

  const parseNumber = (value: any) => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;
    const parsed = Number(String(value).replace(',', '.').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const normalizeText = (value: any) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

  const normalizeSectorName = (value: any) => {
    const normalized = normalizeText(value);
    const direct = PRODUCTION_STEPS.find(step => normalizeText(step.name) === normalized);
    if (direct) return direct.name;

    const sectorAliases: Record<string, string> = {
      MONTAGEMFINAL: 'Montagem Final',
      MONTFINAL: 'Montagem Final',
      MONTAGEMFINALTAMPA: 'Montagem Final',
      MF: 'Montagem Final',
      PINTURATANQUE: 'Pintura Tanque',
      PINTURATANQUETAMPA: 'Pintura Tanque',
      PINTURATANQUEETAMPA: 'Pintura Tanque',
      PINTTANQUE: 'Pintura Tanque',
      MPA: 'MPA',
      SOLDATANQUE: 'Solda Tanque',
      SOLDATANQUETAMPA: 'Solda Tanque',
      SOLDATANQUEETAMPA: 'Solda Tanque',
      SOLDTANQUE: 'Solda Tanque',
      BOBINAGEMAT: 'Bobinagem AT',
      BOBINAGEMALTA: 'Bobinagem AT',
      MONTAGEMNUCLEO: 'Montagem Núcleo',
      MONTAGEMDONUCLEO: 'Montagem Núcleo',
      MONTNUCLEO: 'Montagem Núcleo',
      ESTAMPARIA: 'Estamparia',
      ESTAMPTANQUETAMPA: 'Estamparia',
      ESTAMPARIATANQUETAMPA: 'Estamparia',
      ESTAMPARIATANQUE: 'Estamparia',
      PINTURAFERRAGEM: 'Pintura Ferragem',
      PINTFERRAGEM: 'Pintura Ferragem',
      BOBINAGEMBT: 'Bobinagem BT',
      BOBINAGEMBAIXA: 'Bobinagem BT',
      CORTENUCLEO: 'Corte Núcleo',
      CORTEDONUCLEO: 'Corte Núcleo',
      FERRAGEM: 'Ferragem',
      ISOLANTE: 'Isolante'
    };

    return sectorAliases[normalized] || String(value ?? '').trim();
  };

  const normalizeOp = (value: any) => {
    // A OP pode vir do Sankhya como texto. Esta limpeza remove espaços comuns,
    // espaços invisíveis, quebras de linha, tabs e mantém somente os dígitos.
    return String(value ?? '')
      .trim()
      .replace(/\u00A0/g, '')
      .replace(/\s+/g, '')
      .replace(/\.0+$/, '')
      .replace(/[^0-9]/g, '');
  };

  const normalizeQty = (value: any) => Math.round(parseNumber(value) * 1000) / 1000;

  const getValidationKey = (op: string, data: string, setor: string) =>
    `${normalizeOp(op)}|${data}|${normalizeText(normalizeSectorName(setor))}`;


  const buildValidationResults = (systemRows: SankhyaProgramRow[], stepsForValidation: OPStep[] = calculatedSteps) => {
    if (stepsForValidation.length === 0) {
      setErrorInfo('Gere a programação do painel antes de validar com o relatório do Sankhya.');
      setTimeout(() => setErrorInfo(null), 3500);
      setValidationResults([]);
      return;
    }

    const panelMap = new Map<string, OPStep>();
    stepsForValidation.forEach(step => panelMap.set(getValidationKey(step.op, step.usedDate, step.stepName), step));

    const systemMap = new Map<string, SankhyaProgramRow[]>();
    const systemByOpSector = new Map<string, SankhyaProgramRow[]>();
    const systemByOp = new Map<string, SankhyaProgramRow[]>();
    const systemByOpDate = new Map<string, SankhyaProgramRow[]>();

    systemRows.forEach(row => {
      const normalizedOp = normalizeOp(row.op);
      const normalizedSector = normalizeText(normalizeSectorName(row.setor));

      const exactKey = getValidationKey(row.op, row.data, row.setor);
      const exactList = systemMap.get(exactKey) || [];
      exactList.push(row);
      systemMap.set(exactKey, exactList);

      const opSectorKey = `${normalizedOp}|${normalizedSector}`;
      const sectorList = systemByOpSector.get(opSectorKey) || [];
      sectorList.push(row);
      systemByOpSector.set(opSectorKey, sectorList);

      const opList = systemByOp.get(normalizedOp) || [];
      opList.push(row);
      systemByOp.set(normalizedOp, opList);

      const opDateKey = `${normalizedOp}|${row.data}`;
      const opDateList = systemByOpDate.get(opDateKey) || [];
      opDateList.push(row);
      systemByOpDate.set(opDateKey, opDateList);
    });

    const buildNotProgrammedObservation = (panelStep: OPStep) => {
      const normalizedOp = normalizeOp(panelStep.op);
      const opDateKey = `${normalizedOp}|${panelStep.usedDate}`;
      const sameOpDateMatches = systemByOpDate.get(opDateKey) || [];
      const sameOpMatches = systemByOp.get(normalizedOp) || [];

      if (sameOpDateMatches.length > 0) {
        const setores = Array.from(new Set(sameOpDateMatches.map(row => normalizeSectorName(row.setor)))).join(', ');
        return `A OP existe no Sankhya nesta data, mas em outro setor. Setores encontrados: ${setores}. Painel: ${panelStep.stepName}.`;
      }

      if (sameOpMatches.length > 0) {
        const amostra = sameOpMatches
          .slice(0, 5)
          .map(row => `${formatToBRLDate(row.data)} / ${normalizeSectorName(row.setor)} / qtd ${row.qtd}`)
          .join(' | ');
        return `A OP existe no Sankhya, mas não com a mesma combinação de data e setor. Painel: ${formatToBRLDate(panelStep.usedDate)} / ${panelStep.stepName} / qtd ${panelStep.qtd_mf}. Sankhya: ${amostra}${sameOpMatches.length > 5 ? '...' : ''}`;
      }

      return `OP não encontrada no relatório do Sankhya após normalização. OP painel normalizada: ${normalizedOp}.`;
    };

    const results: ValidationResult[] = [];

    stepsForValidation.forEach(panelStep => {
      const exactKey = getValidationKey(panelStep.op, panelStep.usedDate, panelStep.stepName);
      const exactMatches = systemMap.get(exactKey) || [];
      const opSectorKey = `${normalizeOp(panelStep.op)}|${normalizeText(normalizeSectorName(panelStep.stepName))}`;
      const sameOpSectorMatches = systemByOpSector.get(opSectorKey) || [];

      if (exactMatches.length === 1) {
        const match = exactMatches[0];
        const qtdPainel = normalizeQty(panelStep.qtd_mf);
        const qtdSistema = normalizeQty(match.qtd);
        if (qtdPainel === qtdSistema) {
          results.push({ status: 'OK', op: panelStep.op, dataPainel: panelStep.usedDate, dataSistema: match.data, setor: panelStep.stepName, qtdPainel: panelStep.qtd_mf, qtdSistema: match.qtd, linhaPainel: panelStep.linha, linhaSistema: match.linha, observacao: 'Programação encontrada corretamente no Sankhya, incluindo a quantidade.' });
        } else {
          results.push({ status: 'Quantidade divergente', op: panelStep.op, dataPainel: panelStep.usedDate, dataSistema: match.data, setor: panelStep.stepName, qtdPainel: panelStep.qtd_mf, qtdSistema: match.qtd, linhaPainel: panelStep.linha, linhaSistema: match.linha, observacao: 'OP, data e setor conferem, mas a quantidade está diferente no Sankhya.' });
        }
      } else if (exactMatches.length > 1) {
        const first = exactMatches[0];
        results.push({ status: 'Duplicado', op: panelStep.op, dataPainel: panelStep.usedDate, dataSistema: first.data, setor: panelStep.stepName, qtdPainel: panelStep.qtd_mf, qtdSistema: first.qtd, linhaPainel: panelStep.linha, linhaSistema: first.linha, observacao: 'A mesma combinação OP + Data + Setor aparece ' + exactMatches.length + 'x no relatório do Sankhya.' });
      } else if (sameOpSectorMatches.length > 0) {
        const first = sameOpSectorMatches[0];
        results.push({ status: 'Data divergente', op: panelStep.op, dataPainel: panelStep.usedDate, dataSistema: first.data, setor: panelStep.stepName, qtdPainel: panelStep.qtd_mf, qtdSistema: first.qtd, linhaPainel: panelStep.linha, linhaSistema: first.linha, observacao: 'A OP e o setor existem no Sankhya, mas a data programada é diferente.' });
      } else {
        results.push({ status: 'Não programado', op: panelStep.op, dataPainel: panelStep.usedDate, setor: panelStep.stepName, qtdPainel: panelStep.qtd_mf, linhaPainel: panelStep.linha, observacao: buildNotProgrammedObservation(panelStep) });
      }
    });

    // Extras são exibidos somente no modal de validação. A agenda principal continua sendo a base do painel.
    systemMap.forEach((rows, key) => {
      if (panelMap.has(key)) return;
      const first = rows[0];
      results.push({ status: 'Extra', op: first.op, dataSistema: first.data, setor: first.setor, qtdSistema: first.qtd, linhaSistema: first.linha, observacao: rows.length > 1 ? 'Existe no Sankhya, não existe no painel e aparece ' + rows.length + 'x no relatório.' : 'Existe no Sankhya, mas não existe na programação calculada pelo painel.' });
    });

    results.sort((a, b) => {
      const statusOrder: Record<ValidationStatus, number> = { 'Não programado': 0, 'Data divergente': 1, 'Quantidade divergente': 2, Duplicado: 3, Extra: 4, OK: 5 };
      if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
      if (a.op !== b.op) return a.op.localeCompare(b.op, undefined, { numeric: true });
      return (a.dataPainel || a.dataSistema || '').localeCompare(b.dataPainel || b.dataSistema || '');
    });

    setValidationResults(results);
  };

  const handleValidationFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorInfo(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result;
        const wb = XLSX.read(buffer, { type: 'array', cellDates: true, dateNF: 'dd/MM/yyyy' });
        const ws = wb.Sheets[wb.SheetNames[0]];

        const opAliases = ['OP-Pai', 'OP Pai', 'OPPAI', 'OP Pai ', 'OP', 'Nro OP', 'NRO OP', 'Nro. OP'];
        const dateAliases = ['Dt.Programada', 'Dt Programada', 'Data Programada', 'DATA PROGRAMADA', 'DT PROGRAMADA', 'Dia', 'Data'];
        const sectorAliases = ['Descr.Atividade', 'Descr Atividade', 'Descricao Atividade', 'Descrição Atividade', 'Descrição (Atividade)', 'Descr. Atividade', 'Desc Atividade', 'Setor'];
        const codAliases = ['Atividade', 'Cod.Atividade', 'Cod Atividade', 'COD ATIVIDADE', 'Codigo Atividade', 'Cód. Atividade', 'Cód Atividade', 'Cod Sankhya', 'COD SANKHYA', 'Código Sankhya'];
        const sectorOrCodAliases = [...sectorAliases, ...codAliases];
        const qtdAliases = ['Qtd.Programada', 'Qtd Programada', 'Quantidade Programada', 'QTD PROGRAMADA', 'Qtd', 'Quantidade'];
        const linhaAliases = ['Linha Prod', 'Linha Produção', 'Linha Producao', 'Linha'];

        // O relatório do Sankhya geralmente vem com cabeçalho, emissão e total
        // nas primeiras linhas. Por isso não podemos assumir que a linha 1 é o cabeçalho.
        const rows = XLSX.utils.sheet_to_json<any[]>(ws, {
          header: 1,
          defval: '',
          raw: false,
          dateNF: 'dd/MM/yyyy'
        });

        const headerRowIndex = findHeaderRowIndex(rows, [opAliases, dateAliases, sectorOrCodAliases]);
        if (headerRowIndex < 0) {
          setErrorInfo('Não encontrei o cabeçalho do Sankhya. O relatório precisa ter OP-Pai, Dt.Programada e Atividade/Cód. Atividade ou Descr.Atividade.');
          setSankhyaRows([]);
          setValidationResults([]);
          return;
        }

        const headers = rows[headerRowIndex];
        const parsedRows: SankhyaProgramRow[] = rows.slice(headerRowIndex + 1)
          .map(row => {
            const opValue = getCellFromRowArray(headers, row, opAliases);
            const dateValue = getCellFromRowArray(headers, row, dateAliases);
            const sectorValue = getCellFromRowArray(headers, row, sectorAliases);
            const codValue = getCellFromRowArray(headers, row, codAliases);

            return {
              op: normalizeOp(opValue),
              data: parseExcelDate(dateValue) || '',
              setor: normalizeSectorName(mapCodToSetor(codValue, sectorValue)),
              qtd: parseNumber(getCellFromRowArray(headers, row, qtdAliases)),
              linha: String(getCellFromRowArray(headers, row, linhaAliases) ?? '').trim().toUpperCase()
            };
          })
          .filter(row => row.op && row.data && row.setor);

        if (parsedRows.length === 0) {
          setErrorInfo('Encontrei o cabeçalho do Sankhya, mas nenhuma linha válida com OP, data programada e setor. Verifique se o relatório tem dados abaixo do cabeçalho.');
          setSankhyaRows([]);
          setValidationResults([]);
          return;
        }

        setSankhyaRows(parsedRows);
        buildValidationResults(parsedRows);
      } catch (error) {
        console.error(error);
        setErrorInfo('Não foi possível ler o relatório do Sankhya. Envie um arquivo .xls ou .xlsx válido.');
      }
    };
    reader.onerror = () => setErrorInfo('Erro ao carregar o relatório do Sankhya. Tente novamente.');
    reader.readAsArrayBuffer(file);
    if (validationFileInputRef.current) validationFileInputRef.current.value = '';
  };

  const openValidationModal = () => { setIsValidationModalOpen(true); setErrorInfo(null); };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorInfo(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result;
        const wb = XLSX.read(buffer, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

        const parsedOPs: RawOP[] = data.map((row) => {
          const data_mf_raw = getCellValue(row, ['DATA_MF', 'DATA MF', 'Data MF', 'Data Montagem Final']);
          const parsedDate = parseExcelDate(data_mf_raw) || '';
          return {
            op: String(getCellValue(row, ['OP', 'ORDEM', 'ORDEM PRODUCAO', 'ORDEM DE PRODUCAO']) ?? '').trim(),
            linha: String(getCellValue(row, ['LINHA', 'Linha']) ?? '').trim().toUpperCase(),
            data_mf: parsedDate,
            qtd_mf: parseNumber(getCellValue(row, ['QTD_MF', 'QTD MF', 'QTD', 'QUANTIDADE', 'Quantidade MF'])),
          };
        }).filter(op => op.op && op.data_mf);

        if (parsedOPs.length === 0) {
          setErrorInfo('Nenhuma OP carregada. Verifique se o Excel tem as colunas OP, LINHA, DATA_MF e QTD_MF.');
          setRawOPs([]);
          return;
        }

        setRawOPs(parsedOPs);
        setCalculatedSteps([]);
        setSankhyaRows([]);
        setValidationResults([]);
      } catch (error) {
        console.error(error);
        setErrorInfo('Não foi possível ler o arquivo. Envie um Excel .xlsx válido.');
      }
    };
    reader.onerror = () => setErrorInfo('Erro ao carregar o arquivo. Tente novamente.');
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getUniqueStepKey = (step: OPStep) => {
    // Regra de duplicidade: a mesma OP pode repetir em datas diferentes
    // e no mesmo dia em setores diferentes. O que não pode repetir é:
    // OP + Data Programada + Setor.
    return `${step.op}|${step.usedDate}|${step.stepName}`;
  };

  const removeDuplicateSteps = (steps: OPStep[]) => {
    const uniqueSteps = new Map<string, OPStep>();

    steps.forEach(step => {
      const key = getUniqueStepKey(step);
      if (!uniqueSteps.has(key)) {
        uniqueSteps.set(key, step);
      }
    });

    return Array.from(uniqueSteps.values());
  };

  const handleRunTestProgramming = () => {
    if (!testMfDate) {
      setErrorInfo('Informe a data da Montagem Final para testar a programação.');
      setTimeout(() => setErrorInfo(null), 2500);
      return;
    }

    const simulatedOP: RawOP = {
      op: 'TESTE',
      linha: '',
      data_mf: testMfDate,
      qtd_mf: 0,
    };

    setTestSteps(generateStepsForOP(simulatedOP, validDaysConfig));
  };

  const handleOpenTestModal = () => {
    setIsTestModalOpen(true);
    setErrorInfo(null);
  };

  const handleCloseTestModal = () => {
    setIsTestModalOpen(false);
    setTestMfDate('');
    setTestSteps([]);
  };

  const handleGenerate = () => {
    if (rawOPs.length === 0) {
      setErrorInfo('Importe um arquivo Excel primeiro!');
      setTimeout(() => setErrorInfo(null), 3000);
      return;
    }
    
    setErrorInfo(null);
    let newSteps: OPStep[] = [];
    rawOPs.forEach(op => {
      const opSteps = generateStepsForOP(op, validDaysConfig);
      newSteps.push(...opSteps);
    });

    if (calculatedSteps.length > 0) {
      const manualOverrides = new Map<string, string>();
      calculatedSteps.forEach(s => {
        if (s.manualDate) {
          manualOverrides.set(s.id, s.manualDate);
        }
      });

      newSteps = newSteps.map(s => {
        if (manualOverrides.has(s.id)) {
          return { ...s, manualDate: manualOverrides.get(s.id)!, usedDate: manualOverrides.get(s.id)! };
        }
        return s;
      });
    }

    const uniqueSteps = removeDuplicateSteps(newSteps);
    setCalculatedSteps(uniqueSteps);
    if (sankhyaRows.length > 0) {
      buildValidationResults(sankhyaRows, uniqueSteps);
    }
  };


  const filteredSteps = useMemo(() => {
    return calculatedSteps.filter(step => {
      if (filters.dateStart && step.usedDate < filters.dateStart) return false;
      if (filters.dateEnd && step.usedDate > filters.dateEnd) return false;
      if (filters.sector && step.stepName !== filters.sector) return false;
      if (filters.linha && step.linha !== filters.linha) return false;
      if (filters.op && !step.op.toLowerCase().includes(filters.op.toLowerCase())) return false;
      return true;
    });
  }, [calculatedSteps, filters]);

  const sortedSteps = useMemo(() => {
    return [...filteredSteps].sort((a, b) => {
      const opCompare = a.op.localeCompare(b.op, undefined, { numeric: true });
      if (opCompare !== 0) return opCompare;
      if (a.usedDate !== b.usedDate) return a.usedDate.localeCompare(b.usedDate);
      if (a.stepName !== b.stepName) return a.stepName.localeCompare(b.stepName);
      return a.linha.localeCompare(b.linha);
    });
  }, [filteredSteps]);

  const duplicateOpCounts = useMemo(() => {
    const counts = new Map<string, number>();
    sortedSteps.forEach(step => {
      counts.set(step.op, (counts.get(step.op) || 0) + 1);
    });
    return counts;
  }, [sortedSteps]);

  const getRowKey = (step: OPStep) => `${step.op}|${step.data_mf}|${step.usedDate}|${step.stepName}|${step.qtd_mf}|${step.linha}`;

  const copyValue = async (value: string | number, label: string, rowKey: string) => {
    const text = String(value);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedValue(`${label}:${text}`);
      setCopiedRowKey(rowKey);
      setTimeout(() => setCopiedValue(null), 1200);
    } catch (error) {
      console.error(error);
      setErrorInfo(`Não foi possível copiar ${label}.`);
      setTimeout(() => setErrorInfo(null), 2500);
    }
  };

  const visibleValidationResults = useMemo(() => {
    return showOnlyErrors ? validationResults.filter(result => ERROR_STATUSES.includes(result.status)) : validationResults;
  }, [validationResults, showOnlyErrors]);

  const validationCounts = useMemo(() => {
    return validationResults.reduce((acc, result) => {
      acc[result.status] = (acc[result.status] || 0) + 1;
      return acc;
    }, {} as Record<ValidationStatus, number>);
  }, [validationResults]);

  const validationByPanelKey = useMemo(() => {
    const map = new Map<string, ValidationResult>();
    validationResults.forEach(result => {
      if (!result.dataPainel) return;
      map.set(getValidationKey(result.op, result.dataPainel, result.setor), result);
    });
    return map;
  }, [validationResults]);

  const getMainValidationInfo = (step: OPStep): MainValidationInfo | null => {
    if (sankhyaRows.length === 0) return null;
    const result = validationByPanelKey.get(getValidationKey(step.op, step.usedDate, step.stepName));
    if (!result) return { status: 'Não programado', observacao: 'Não encontrado no relatório do Sankhya.' };
    return { status: result.status, dataSistema: result.dataSistema, observacao: result.observacao };
  };

  const displayedSteps = useMemo(() => {
    if (!showOnlyErrors || sankhyaRows.length === 0) return sortedSteps;
    return sortedSteps.filter(step => {
      const status = getMainValidationInfo(step)?.status;
      return status ? ERROR_STATUSES.includes(status) : false;
    });
  }, [sortedSteps, showOnlyErrors, sankhyaRows.length, validationByPanelKey]);

  const totalOpsUnique = new Set(displayedSteps.map(s => s.op)).size;
  const totalSectors = new Set(displayedSteps.map(s => s.stepName)).size;
  const totalDates = new Set(displayedSteps.map(s => s.usedDate)).size;

  return (
    <div className="h-screen w-full overflow-hidden flex flex-col font-sans">
      {/* Header */}
      <header className="h-16 bg-brand-card border-b border-brand-border flex items-center justify-between px-6 shrink-0 relative z-10">
        <div className="font-[800] text-[1.2rem] text-brand-accent tracking-tight flex items-center gap-2">
          PROGRAMAÇÃO DE PRODUÇÃO <span className="font-light opacity-50 text-white">- ITAM</span>
        </div>
        
        <div className="flex gap-3">
          <input 
            type="file" 
            accept=".xlsx,.xls" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileUpload}
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 rounded-md text-[13px] font-semibold cursor-pointer flex items-center gap-2 border border-brand-border bg-brand-card text-white hover:bg-brand-border transition-colors shadow-sm"
          >
            📂 Importar Excel
          </button>
          <button 
            onClick={() => setIsCalendarOpen(true)}
            className="px-4 py-2 rounded-md text-[13px] font-semibold cursor-pointer flex items-center gap-2 border border-brand-border bg-brand-card text-white hover:bg-brand-border transition-colors shadow-sm"
          >
            📅 Calendário
          </button>
          <button 
            onClick={openValidationModal}
            className="px-4 py-2 rounded-md text-[13px] font-semibold cursor-pointer flex items-center gap-2 border border-brand-border bg-brand-card text-white hover:bg-brand-border transition-colors shadow-sm"
          >
            <FileCheck2 className="w-4 h-4" /> Validar programação
          </button>
          <button 
            onClick={handleOpenTestModal}
            className="px-4 py-2 rounded-md text-[13px] font-semibold cursor-pointer flex items-center gap-2 border border-brand-border bg-brand-card text-white hover:bg-brand-border transition-colors shadow-sm"
          >
            <FlaskConical className="w-4 h-4" /> Testar programação
          </button>
          <button 
            onClick={handleGenerate}
            className="px-4 py-2 rounded-md text-[13px] font-semibold cursor-pointer flex items-center gap-2 bg-brand-accent text-black border-none hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            ⚡ Gerar Programação
          </button>
        </div>
      </header>

      {/* Stats */}
      <div className="h-[90px] grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-brand-border border-b border-brand-border shrink-0">
        <StatCard label="Total de OPs" value={totalOpsUnique || '-'} />
        <StatCard label="Etapas Programadas" value={displayedSteps.length || '-'} />
        <StatCard label="Setores Ativos" value={totalSectors} />
        <StatCard label="Datas do Ciclo" value={totalDates || '-'} />
      </div>

      {/* Main Layout */}
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[280px] border-r border-brand-border p-5 flex flex-col gap-6 overflow-y-auto shrink-0 hidden md:flex">
          <FilterBar 
            filters={filters} 
            setFilters={setFilters} 
            sectors={PRODUCTION_STEPS.map(s => s.name)} 
          />
        </aside>

        {/* Content Area */}
        <section className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 px-6 border-b border-brand-border text-[12px] font-bold uppercase text-brand-muted flex justify-between shrink-0 tracking-widest">
            <span>Agenda de Produção</span>
            <div className="flex items-center gap-4">
              {sankhyaRows.length > 0 && (
                <label className="flex items-center gap-2 normal-case tracking-normal text-white text-xs font-semibold">
                  <input type="checkbox" checked={showOnlyErrors} onChange={(e) => setShowOnlyErrors(e.target.checked)} className="accent-[#00EE76]" />
                  Exibir erros
                </label>
              )}
              <span>{filters.dateStart || filters.dateEnd ? `${filters.dateStart ? formatToBRLDate(filters.dateStart) : 'Início'} até ${filters.dateEnd ? formatToBRLDate(filters.dateEnd) : 'Fim'}` : 'Todas as Datas'}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-0">
            {displayedSteps.length === 0 ? (
              <div className="py-20 text-center flex flex-col items-center justify-center opacity-50">
                <CalendarIcon className="w-12 h-12 text-brand-muted mb-4" />
                <h3 className="text-white font-medium text-lg">Nenhuma programação encontrada</h3>
                <p className="text-brand-muted text-sm mt-1">Gere a programação ou altere os filtros.</p>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-brand-bg z-10 border-b border-brand-border">
                  <tr className="text-left text-[11px] uppercase tracking-widest text-brand-muted">
                    <th className="p-3 px-6 font-bold w-[180px]">OP</th>
                    <th className="p-3 px-6 font-bold w-[190px]">Data Programada</th>
                    <th className="p-3 px-6 font-bold w-[120px]">QTD</th>
                    <th className="p-3 px-6 font-bold">Setor</th>
                    <th className="p-3 px-6 font-bold w-[90px]">Linha</th>
                    <th className="p-3 px-6 font-bold w-[170px]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedSteps.map((step, index) => {
                    const rowKey = getRowKey(step);
                    const isRowCopied = copiedRowKey === rowKey;
                    const duplicateCount = duplicateOpCounts.get(step.op) || 0;
                    const isDuplicateOp = duplicateCount > 1;
                    const formattedDate = formatToBRLDate(step.usedDate);
                    const validationInfo = getMainValidationInfo(step);
                    const isCopiedOP = copiedValue === `OP:${step.op}`;
                    const isCopiedDATA = copiedValue === `DATA:${formattedDate}`;
                    const isCopiedQTD = copiedValue === `QTD:${step.qtd_mf}`;
                    return (
                      <tr 
                        key={`${step.id}_${step.data_mf}_${index}`}
                        className={`border-b border-brand-border transition-colors border-l-[3px] ${
                          isRowCopied
                            ? 'bg-brand-accent/15 border-l-brand-accent border-r-[3px] border-r-brand-accent shadow-[inset_0_0_0_1px_rgba(242,125,38,0.35)]'
                            : isDuplicateOp
                              ? 'border-l-white border-r-[3px] border-r-white hover:bg-[#1A1A1D] hover:border-l-white hover:border-r-white'
                              : 'border-l-transparent border-r-[3px] border-r-transparent hover:bg-[#1A1A1D] hover:border-l-brand-accent'
                        }`}
                      >
                        <td className="p-[14px] px-6">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-[15px] font-bold text-brand-accent">{step.op}</span>
                            {isDuplicateOp && (
                              <span className="rounded-full border border-white/40 bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white" title="OP aparece em mais de uma linha">
                                {duplicateCount}x
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => copyValue(step.op, 'OP', rowKey)}
                              className="h-8 w-8 rounded-md border border-brand-border bg-[#1A1A1D] text-white hover:bg-brand-accent hover:text-black transition-colors flex items-center justify-center"
                              title="Copiar OP"
                            >
                              {isCopiedOP ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                        <td className="p-[14px] px-6">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-[15px] font-extrabold text-white bg-brand-accent/15 border border-brand-accent/30 rounded-md px-3 py-1">{formattedDate}</span>
                            <button
                              type="button"
                              onClick={() => copyValue(formattedDate, 'DATA', rowKey)}
                              className="h-8 w-8 rounded-md border border-brand-border bg-[#1A1A1D] text-white hover:bg-brand-accent hover:text-black transition-colors flex items-center justify-center"
                              title="Copiar Data"
                            >
                              {isCopiedDATA ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                        <td className="p-[14px] px-6">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-[15px] font-bold text-white">{step.qtd_mf}</span>
                            <button
                              type="button"
                              onClick={() => copyValue(step.qtd_mf, 'QTD', rowKey)}
                              className="h-8 w-8 rounded-md border border-brand-border bg-[#1A1A1D] text-white hover:bg-brand-accent hover:text-black transition-colors flex items-center justify-center"
                              title="Copiar QTD"
                            >
                              {isCopiedQTD ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                        <td className="p-[14px] px-6 text-[13px] text-white font-medium">
                          {step.stepName}
                        </td>
                        <td className="p-[14px] px-6">
                          <span className="bg-[#2A2A2E] px-2 py-1 rounded text-[11px] font-semibold text-brand-muted">{step.linha || '-'}</span>
                        </td>
                        <td className="p-[14px] px-6">
                          {validationInfo ? (
                            <span title={validationInfo.observacao} className={`rounded-md border px-2 py-1 text-[11px] font-extrabold ${validationInfo.status === 'OK' ? 'border-green-500/30 bg-green-500/10 text-green-300' : validationInfo.status === 'Não programado' ? 'border-red-500/30 bg-red-500/10 text-red-300' : validationInfo.status === 'Data divergente' || validationInfo.status === 'Quantidade divergente' ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300' : 'border-purple-500/30 bg-purple-500/10 text-purple-300'}`}>
                              {validationInfo.status}
                            </span>
                          ) : (
                            <span className="text-brand-muted text-xs">Sem validação</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      {/* Calendar Config Modal */}
      <CalendarModal 
        isOpen={isCalendarOpen} 
        onClose={() => setIsCalendarOpen(false)} 
        config={validDaysConfig}
        onSave={setValidDaysConfig}
      />
      

      {isValidationModalOpen && (
        <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-[1100px] max-h-[90vh] overflow-hidden rounded-xl border border-brand-border bg-brand-card shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between">
              <div>
                <h2 className="text-white text-lg font-extrabold tracking-tight flex items-center gap-2">
                  <FileCheck2 className="w-5 h-5 text-brand-accent" /> Validar programação
                </h2>
                <p className="text-brand-muted text-xs mt-1">Importe o relatório do Sankhya para comparar com a programação calculada pelo painel.</p>
              </div>
              <button type="button" onClick={() => setIsValidationModalOpen(false)} className="h-9 w-9 rounded-md border border-brand-border bg-[#1A1A1D] text-white hover:bg-brand-accent hover:text-black transition-colors flex items-center justify-center" title="Fechar">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 border-b border-brand-border flex flex-col gap-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-md border border-brand-border bg-brand-bg px-3 py-2 text-xs font-bold text-white">OK: {validationCounts.OK || 0}</span>
                  <span className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300">Não programado: {validationCounts['Não programado'] || 0}</span>
                  <span className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs font-bold text-yellow-300">Data divergente: {validationCounts['Data divergente'] || 0}</span>
                  <span className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs font-bold text-yellow-300">Extra: {validationCounts.Extra || 0}</span>
                  <span className="rounded-md border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs font-bold text-purple-300">Duplicado: {validationCounts.Duplicado || 0}</span>
                </div>
                <label className="flex items-center gap-2 text-sm text-white font-semibold">
                  <input type="checkbox" checked={showOnlyErrors} onChange={(e) => setShowOnlyErrors(e.target.checked)} className="accent-[#00EE76]" />
                  Exibir erros
                </label>
              </div>
              <div className="flex flex-col md:flex-row gap-3 md:items-center">
                <input type="file" accept=".xls,.xlsx" className="hidden" ref={validationFileInputRef} onChange={handleValidationFileUpload} />
                <button type="button" onClick={() => validationFileInputRef.current?.click()} className="px-5 py-2 rounded-md text-[13px] font-bold bg-brand-accent text-black hover:opacity-90 transition-opacity whitespace-nowrap">
                  Importar relatório do Sankhya
                </button>
                <span className="text-brand-muted text-xs">Regra usada: OP + Data Programada + Setor + QTD. Linhas importadas: {sankhyaRows.length || 0}</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {validationResults.length === 0 ? (
                <div className="py-12 text-center text-brand-muted text-sm">Importe o relatório do Sankhya para iniciar a validação.</div>
              ) : visibleValidationResults.length === 0 ? (
                <div className="py-12 text-center text-brand-muted text-sm">Nenhum item incorreto encontrado com o filtro atual.</div>
              ) : (
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-brand-bg border-b border-brand-border z-10">
                    <tr className="text-left text-[11px] uppercase tracking-widest text-brand-muted">
                      <th className="p-3 px-4 font-bold w-[150px]">Status</th><th className="p-3 px-4 font-bold w-[120px]">OP</th><th className="p-3 px-4 font-bold w-[150px]">Data Painel</th><th className="p-3 px-4 font-bold w-[150px]">Data Sankhya</th><th className="p-3 px-4 font-bold">Setor</th><th className="p-3 px-4 font-bold w-[110px]">QTD Painel</th><th className="p-3 px-4 font-bold w-[120px]">QTD Sankhya</th><th className="p-3 px-4 font-bold">Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleValidationResults.map((result, index) => {
                      const statusClass = result.status === 'OK' ? 'border-green-500/30 bg-green-500/10 text-green-300' : result.status === 'Não programado' ? 'border-red-500/30 bg-red-500/10 text-red-300' : result.status === 'Data divergente' || result.status === 'Quantidade divergente' ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300' : result.status === 'Extra' ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300' : 'border-purple-500/30 bg-purple-500/10 text-purple-300';
                      return (
                        <tr key={result.status + '_' + result.op + '_' + result.setor + '_' + index} className="border-b border-brand-border hover:bg-[#1A1A1D]">
                          <td className="p-3 px-4"><span className={'rounded-md border px-2 py-1 text-[11px] font-extrabold ' + statusClass}>{result.status}</span></td>
                          <td className="p-3 px-4 font-mono text-brand-accent font-bold">{result.op}</td>
                          <td className="p-3 px-4 font-mono text-white">{result.dataPainel ? formatToBRLDate(result.dataPainel) : '-'}</td>
                          <td className="p-3 px-4 font-mono text-white">{result.dataSistema ? formatToBRLDate(result.dataSistema) : '-'}</td>
                          <td className="p-3 px-4 text-white text-sm">{result.setor}</td>
                          <td className="p-3 px-4 font-mono text-white">{result.qtdPainel ?? '-'}</td>
                          <td className="p-3 px-4 font-mono text-white">{result.qtdSistema ?? '-'}</td>
                          <td className="p-3 px-4 text-brand-muted text-xs">{result.observacao}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {isTestModalOpen && (
        <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-[620px] max-h-[90vh] overflow-hidden rounded-xl border border-brand-border bg-brand-card shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between">
              <div>
                <h2 className="text-white text-lg font-extrabold tracking-tight flex items-center gap-2">
                  <FlaskConical className="w-5 h-5 text-brand-accent" /> Testar programação
                </h2>
                <p className="text-brand-muted text-xs mt-1">Simula as datas sem adicionar nada à lista principal.</p>
              </div>
              <button
                type="button"
                onClick={handleCloseTestModal}
                className="h-9 w-9 rounded-md border border-brand-border bg-[#1A1A1D] text-white hover:bg-brand-accent hover:text-black transition-colors flex items-center justify-center"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 border-b border-brand-border">
              <label className="block text-[11px] uppercase tracking-widest text-brand-muted font-bold mb-2">
                Data da Montagem Final
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="date"
                  value={testMfDate}
                  onChange={(e) => setTestMfDate(e.target.value)}
                  className="flex-1 bg-brand-bg border border-brand-border rounded-md px-3 py-2 text-white text-sm outline-none focus:border-brand-accent"
                />
                <button
                  type="button"
                  onClick={handleRunTestProgramming}
                  className="px-5 py-2 rounded-md text-[13px] font-bold bg-brand-accent text-black hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  OK / Simular
                </button>
              </div>
              <p className="text-brand-muted text-xs mt-3">
                O cálculo usa o calendário atual, incluindo dias bloqueados e dias extras liberados.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {testSteps.length === 0 ? (
                <div className="py-12 text-center text-brand-muted text-sm">
                  Informe a data da Montagem Final e clique em OK para visualizar a programação de teste.
                </div>
              ) : (
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-brand-bg border-b border-brand-border">
                    <tr className="text-left text-[11px] uppercase tracking-widest text-brand-muted">
                      <th className="p-3 px-5 font-bold">Setor</th>
                      <th className="p-3 px-5 font-bold w-[190px]">Data Programada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testSteps.map((step) => (
                      <tr key={step.id} className="border-b border-brand-border hover:bg-[#1A1A1D]">
                        <td className="p-3 px-5 text-white text-sm font-medium">{step.stepName}</td>
                        <td className="p-3 px-5">
                          <span className="font-mono text-[14px] font-extrabold text-white bg-brand-accent/15 border border-brand-accent/30 rounded-md px-3 py-1">
                            {formatToBRLDate(step.usedDate)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {errorInfo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#2A1010] border border-red-500/20 text-red-400 px-6 py-3 rounded-lg text-[13px] font-semibold shadow-2xl z-[100] flex items-center gap-2">
          <span className="w-5 h-5 flex items-center justify-center rounded-full bg-red-500/20">!</span>
          {errorInfo}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string, value: string | number }) {
  return (
    <div className="bg-brand-bg py-4 px-6 flex flex-col justify-center">
      <span className="text-[11px] uppercase text-brand-muted tracking-wide mb-1 font-semibold">{label}</span>
      <span className="text-2xl font-bold font-mono text-white tracking-tight">{value}</span>
    </div>
  );
}
