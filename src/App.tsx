import React, { useEffect, useMemo, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { BarChart3, Calendar as CalendarIcon, Copy, Check, FileSpreadsheet, FlaskConical, X, FileCheck2, ChevronRight, Factory, Inbox, List, SlidersHorizontal, Upload, Zap, ArrowUpDown } from 'lucide-react';
import { 
  RawOP, 
  OPStep, 
  ValidDaysConfig, 
  PRODUCTION_STEPS, 
  generateStepsForOP, 
  parseExcelDate,
  shouldIncludeProductionStep 
} from './lib/productionLogic';
import { formatToBRLDate } from './lib/utils';
import { CalendarModal } from './components/CalendarModal';
import { FilterBar } from './components/FilterBar';

type SankhyaProgramRow = { op: string; data: string; setor: string; qtd: number; linha: string; };
type SeriesRow = { op: string; data: string; setor: string; atividade: string; qtd: number; serieInicial: number; serieFinal: number; rawSetor: string; };
type SeriesValidationStatus = 'OK' | 'Erro';
type SeriesValidationResult = { status: SeriesValidationStatus; op: string; grupo: string; lote: string; setores: string; qtd?: number; serieInicial?: number; serieFinal?: number; datas: string; observacao: string; };
type ValidationStatus = 'OK' | 'Programado parcial' | 'Não programado' | 'Data divergente' | 'Quantidade divergente' | 'Duplicado' | 'Extra';
type ValidationResult = { status: ValidationStatus; op: string; dataPainel?: string; dataSistema?: string; setor: string; qtdPainel?: number; qtdSistema?: number; linhaPainel?: string; linhaSistema?: string; observacao: string; };
type MainValidationInfo = { status: ValidationStatus; dataSistema?: string; observacao: string; };
type SortKey = 'op' | 'usedDate' | 'qtd_mf' | 'stepName' | 'linha' | 'status' | 'opDate';
type SortDirection = 'asc' | 'desc';
type SortConfig = { key: SortKey; direction: SortDirection } | null;
const ERROR_STATUSES: ValidationStatus[] = ['Não programado', 'Data divergente', 'Quantidade divergente', 'Duplicado', 'Extra'];
const PARTIAL_STATUS: ValidationStatus = 'Programado parcial';
type DisplayStatus = ValidationStatus | 'Sem validação';

const STATUS_BADGE_CLASSES: Record<DisplayStatus, string> = {
  OK: 'border-brand-accent/30 bg-brand-accent/10 text-brand-accent',
  'Programado parcial': 'border-blue-400/30 bg-blue-400/10 text-blue-300',
  'Não programado': 'border-red-400/30 bg-red-400/10 text-red-300',
  'Data divergente': 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  'Quantidade divergente': 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  Duplicado: 'border-purple-400/30 bg-purple-400/10 text-purple-300',
  Extra: 'border-orange-400/30 bg-orange-400/10 text-orange-300',
  'Sem validação': 'border-brand-border bg-brand-surface/70 text-brand-muted',
};

type DashboardBucket = 'conforme' | 'divergente' | 'naoProgramado' | 'semValidacao';
type DashboardGroupStats = Record<DashboardBucket, number>;

const DASHBOARD_BUCKETS: Array<{ key: DashboardBucket; label: string; color: string; description: string }> = [
  { key: 'conforme', label: 'Conforme', color: '#00EE76', description: 'Programado conforme Sankhya' },
  { key: 'divergente', label: 'Divergente', color: '#F97316', description: 'Diferença na data, quantidade ou atividade' },
  { key: 'naoProgramado', label: 'Não programado', color: '#EF4444', description: 'Não encontrado no Sankhya' },
  { key: 'semValidacao', label: 'Sem validação', color: '#6B7280', description: 'Validação ainda não executada' },
];

const createEmptyDashboardStats = (): DashboardGroupStats => ({
  conforme: 0,
  divergente: 0,
  naoProgramado: 0,
  semValidacao: 0,
});

const getDashboardBucket = (status?: ValidationStatus | 'Sem validação'): DashboardBucket => {
  if (!status || status === 'Sem validação') return 'semValidacao';
  if (status === 'OK') return 'conforme';
  if (status === 'Programado parcial') return 'divergente';
  if (status === 'Não programado') return 'naoProgramado';
  return 'divergente';
};

const buildDonutSegments = (stats: DashboardGroupStats, total: number) => {
  if (total <= 0) return [];
  let offset = 25;
  return DASHBOARD_BUCKETS
    .map(bucket => {
      const value = stats[bucket.key];
      if (!value) return null;
      const percentage = (value / total) * 100;
      const segment = {
        ...bucket,
        value,
        percentage,
        dashArray: `${percentage} ${100 - percentage}`,
        dashOffset: -offset,
      };
      offset += percentage;
      return segment;
    })
    .filter(Boolean) as Array<(typeof DASHBOARD_BUCKETS)[number] & { value: number; percentage: number; dashArray: string; dashOffset: number }>;
};


const LINKED_SECTOR_GROUPS = [
  { label: 'Ferragem + Pintura Ferragem', sectors: ['Ferragem', 'Pintura Ferragem'] },
  { label: 'Corte Núcleo + Montagem Núcleo', sectors: ['Corte Núcleo', 'Montagem Núcleo'] },
  { label: 'Estamparia + Solda Tanque + Pintura Tanque', sectors: ['Estamparia', 'Solda Tanque', 'Pintura Tanque'] },
];

const getLinkedSectorGroup = (sector: string) =>
  LINKED_SECTOR_GROUPS.find(group => group.sectors.includes(sector));

const getSectorFilterOptions = () => {
  const groupedSectors = new Set(LINKED_SECTOR_GROUPS.flatMap(group => [...group.sectors]));
  const standaloneSectors = PRODUCTION_STEPS
    .map(step => step.name)
    .filter(sector => !groupedSectors.has(sector));

  return [
    ...LINKED_SECTOR_GROUPS.map(group => group.label),
    ...standaloneSectors,
  ];
};

const getSectorsForFilter = (filterValue: string) => {
  const group = LINKED_SECTOR_GROUPS.find(item => item.label === filterValue);
  return group ? [...group.sectors] : [filterValue];
};

const getSectorGroupLabel = (sector: string) => getLinkedSectorGroup(sector)?.label || sector;
const getSectorGroupOrder = (sector: string) => {
  const groupIndex = LINKED_SECTOR_GROUPS.findIndex(group => group.sectors.includes(sector));
  if (groupIndex >= 0) return groupIndex;
  return LINKED_SECTOR_GROUPS.length + PRODUCTION_STEPS.findIndex(step => step.name === sector);
};
const getSectorOrderInsideGroup = (sector: string) => {
  const group = getLinkedSectorGroup(sector);
  if (!group) return 0;
  return group.sectors.indexOf(sector);
};
const getGroupedStepKey = (step: OPStep) => `${step.op}|${Math.round(Number(step.qtd_mf || 0) * 1000) / 1000}|${getSectorGroupLabel(step.stepName)}`;



const SECTOR_SANKHYA_CODES: Record<string, string[]> = {
  'Bobinagem AT': ['2658', '2480', '2026'],
  'Bobinagem BT': ['2640', '2487', '2033'],
  'Corte Núcleo': ['2714', '2471'],
  'Estamparia': ['2881', '2829'],
  'Ferragem': ['2818'],
  'Isolante': ['2694'],
  'Montagem Final': ['2701', '2436', '2198', '2187'],
  'Montagem Núcleo': ['2716', '2473'],
  'MPA': ['2855', '2460', '2907', '2896'],
  'Pintura Ferragem': ['2819', '2512'],
  'Pintura Tanque': ['2885', '2833'],
  'Solda Tanque': ['2883', '2831'],
};

const getSectorSankhyaCodes = (sector: string) => SECTOR_SANKHYA_CODES[sector] || [];

const COD_TO_SETOR: Record<string, string> = {
  '2658':'BOBINAGEM AT','2480':'BOBINAGEM AT','2026':'BOBINAGEM AT',
  '2640':'BOBINAGEM BT','2487':'BOBINAGEM BT','2033':'BOBINAGEM BT',
  '2714':'CORTE NUCLEO','2471':'CORTE NUCLEO',
  '2881':'ESTAMPARIA','2829':'ESTAMPARIA',
  '2818':'FERRAGEM',
  '2694':'ISOLANTE',
  '2701':'Montagem Final','2436':'Montagem Final','2198':'Montagem Final','2187':'Montagem Final',
  '2716':'MONTAGEM NUCLEO','2473':'MONTAGEM NUCLEO',
  '2855':'MPA','2460':'MPA','2907':'MPA','2896':'MPA',
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

const STORAGE_KEYS = {
  validDaysConfig: 'itam_prog_valid_days_config_v1',
  rawOPs: 'itam_prog_raw_ops_v1',
  calculatedSteps: 'itam_prog_calculated_steps_v1',
  sankhyaRows: 'itam_prog_sankhya_rows_v1',
  validationResults: 'itam_prog_validation_results_v1',
  showOnlyErrors: 'itam_prog_show_only_errors_v1',
  showOnlyPartial: 'itam_prog_show_only_partial_v1',
};

const readStorage = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;

  try {
    const stored = window.localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch (error) {
    console.warn(`Não foi possível carregar ${key} do localStorage.`, error);
    return fallback;
  }
};

const writeStorage = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Não foi possível salvar ${key} no localStorage.`, error);
  }
};

const DEFAULT_VALID_DAYS_CONFIG: ValidDaysConfig = {
  invalidDays: [],
  extraValidDays: []
};

export default function App() {
  const [validDaysConfig, setValidDaysConfig] = useState<ValidDaysConfig>(() =>
    readStorage(STORAGE_KEYS.validDaysConfig, DEFAULT_VALID_DAYS_CONFIG)
  );
  
  const [rawOPs, setRawOPs] = useState<RawOP[]>(() => readStorage(STORAGE_KEYS.rawOPs, []));
  const [calculatedSteps, setCalculatedSteps] = useState<OPStep[]>(() =>
    readStorage<OPStep[]>(STORAGE_KEYS.calculatedSteps, [])
      .filter(step => shouldIncludeProductionStep(step.linha, step.stepName))
  );
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testMfDate, setTestMfDate] = useState('');
  const [testSteps, setTestSteps] = useState<OPStep[]>([]);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'programacao' | 'dashboard' | 'validarSerie'>('programacao');
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  // Somente a última linha copiada fica destacada.
  // Ao copiar outra OP ou Data, a linha anterior desmarca automaticamente.
  const [copiedRowKey, setCopiedRowKey] = useState<string | null>(null);

  const [errorInfo, setErrorInfo] = useState<string | null>(null);
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [sankhyaRows, setSankhyaRows] = useState<SankhyaProgramRow[]>(() => readStorage(STORAGE_KEYS.sankhyaRows, []));
  const [validationResults, setValidationResults] = useState<ValidationResult[]>(() => readStorage(STORAGE_KEYS.validationResults, []));
  const [showOnlyErrors, setShowOnlyErrors] = useState<boolean>(() => readStorage(STORAGE_KEYS.showOnlyErrors, false));
  const [showOnlyPartial, setShowOnlyPartial] = useState<boolean>(() => readStorage(STORAGE_KEYS.showOnlyPartial, false));
  const [seriesRows, setSeriesRows] = useState<SeriesRow[]>([]);
  const [seriesValidationResults, setSeriesValidationResults] = useState<SeriesValidationResult[]>([]);
  const [showOnlySeriesErrors, setShowOnlySeriesErrors] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const validationFileInputRef = useRef<HTMLInputElement>(null);
  const seriesFileInputRef = useRef<HTMLInputElement>(null);

  const [filters, setFilters] = useState({
    dateStart: '',
    dateEnd: '',
    sector: '',
    linha: '',
    op: ''
  });
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.validDaysConfig, validDaysConfig);
  }, [validDaysConfig]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.rawOPs, rawOPs);
  }, [rawOPs]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.calculatedSteps, calculatedSteps);
  }, [calculatedSteps]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.sankhyaRows, sankhyaRows);
  }, [sankhyaRows]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.validationResults, validationResults);
  }, [validationResults]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.showOnlyErrors, showOnlyErrors);
  }, [showOnlyErrors]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.showOnlyPartial, showOnlyPartial);
  }, [showOnlyPartial]);


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
    const systemByOpSectorQty = new Map<string, SankhyaProgramRow[]>();
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

      const opSectorQtyKey = `${opSectorKey}|${normalizeQty(row.qtd)}`;
      const sectorQtyList = systemByOpSectorQty.get(opSectorQtyKey) || [];
      sectorQtyList.push(row);
      systemByOpSectorQty.set(opSectorQtyKey, sectorQtyList);

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
      const qtdPainel = normalizeQty(panelStep.qtd_mf);
      const opSectorKey = `${normalizeOp(panelStep.op)}|${normalizeText(normalizeSectorName(panelStep.stepName))}`;
      const opSectorQtyKey = `${opSectorKey}|${qtdPainel}`;
      const sameOpSectorQtyMatches = systemByOpSectorQty.get(opSectorQtyKey) || [];

      const exactQtyMatches = exactMatches.filter(match => normalizeQty(match.qtd) === qtdPainel);

      if (exactQtyMatches.length === 1) {
        const match = exactQtyMatches[0];
        results.push({ status: 'OK', op: panelStep.op, dataPainel: panelStep.usedDate, dataSistema: match.data, setor: panelStep.stepName, qtdPainel: panelStep.qtd_mf, qtdSistema: match.qtd, linhaPainel: panelStep.linha, linhaSistema: match.linha, observacao: 'Programação encontrada corretamente no Sankhya, incluindo data e quantidade.' });
      } else if (exactQtyMatches.length > 1) {
        const first = exactQtyMatches[0];
        results.push({ status: 'Duplicado', op: panelStep.op, dataPainel: panelStep.usedDate, dataSistema: first.data, setor: panelStep.stepName, qtdPainel: panelStep.qtd_mf, qtdSistema: first.qtd, linhaPainel: panelStep.linha, linhaSistema: first.linha, observacao: 'A mesma combinação OP + Data + Setor + Quantidade aparece ' + exactQtyMatches.length + 'x no relatório do Sankhya.' });
      } else if (exactMatches.length > 0) {
        const first = exactMatches[0];
        results.push({ status: 'Quantidade divergente', op: panelStep.op, dataPainel: panelStep.usedDate, dataSistema: first.data, setor: panelStep.stepName, qtdPainel: panelStep.qtd_mf, qtdSistema: first.qtd, linhaPainel: panelStep.linha, linhaSistema: first.linha, observacao: 'OP, data e setor conferem, mas a quantidade está diferente no Sankhya.' });
      } else if (sameOpSectorQtyMatches.length > 0) {
        const first = sameOpSectorQtyMatches[0];
        results.push({ status: 'Data divergente', op: panelStep.op, dataPainel: panelStep.usedDate, dataSistema: first.data, setor: panelStep.stepName, qtdPainel: panelStep.qtd_mf, qtdSistema: first.qtd, linhaPainel: panelStep.linha, linhaSistema: first.linha, observacao: 'OP, setor e quantidade conferem, mas a data programada é diferente no Sankhya.' });
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

    const applyPartialStatusByOpSector = (items: ValidationResult[]) => {
      const grouped = new Map<string, ValidationResult[]>();

      items.forEach(item => {
        if (!item.dataPainel) return;
        const key = `${normalizeOp(item.op)}|${normalizeText(normalizeSectorName(item.setor))}`;
        const list = grouped.get(key) || [];
        list.push(item);
        grouped.set(key, list);
      });

      grouped.forEach(groupItems => {
        const okItems = groupItems.filter(item => item.status === 'OK');
        const missingItems = groupItems.filter(item => item.status === 'Não programado');
        if (okItems.length === 0 || missingItems.length === 0) return;

        const qtdOk = okItems.reduce((sum, item) => sum + normalizeQty(item.qtdPainel || 0), 0);
        const qtdFaltante = missingItems.reduce((sum, item) => sum + normalizeQty(item.qtdPainel || 0), 0);
        const faltas = missingItems
          .slice()
          .sort((a, b) => (a.dataPainel || '').localeCompare(b.dataPainel || ''))
          .map(item => `${formatToBRLDate(item.dataPainel || '')} - ${normalizeQty(item.qtdPainel || 0)} peça(s)`)
          .join(' | ');

        okItems.forEach(item => {
          item.status = PARTIAL_STATUS;
          item.observacao = `Parte deste OP + setor foi encontrada corretamente no Sankhya, mas ainda existe saldo não programado no mesmo setor. Programado: ${qtdOk} peça(s). Faltante: ${qtdFaltante} peça(s). Falta programar: ${faltas}.`;
        });
      });
    };

    const applyPartialStatusByLinkedSectorGroup = (items: ValidationResult[]) => {
      const grouped = new Map<string, ValidationResult[]>();

      items.forEach(item => {
        if (!item.dataPainel) return;
        const linkedGroup = getLinkedSectorGroup(normalizeSectorName(item.setor));
        if (!linkedGroup) return;

        // Complementa a regra antiga sem substituí-la:
        // antes a parcialidade era analisada por OP + setor; agora, quando o setor
        // pertence a um grupo produtivo, também avaliamos OP + grupo + quantidade.
        const key = [
          normalizeOp(item.op),
          normalizeText(linkedGroup.label),
          normalizeQty(item.qtdPainel || 0),
        ].join('|');

        const list = grouped.get(key) || [];
        list.push(item);
        grouped.set(key, list);
      });

      grouped.forEach(groupItems => {
        const okItems = groupItems.filter(item => item.status === 'OK');
        if (okItems.length === 0) return;

        const missingItems = groupItems.filter(item => item.status === 'Não programado');
        if (missingItems.length === 0) return;

        const linkedGroup = getLinkedSectorGroup(normalizeSectorName(groupItems[0].setor));
        if (!linkedGroup) return;

        const sectorsWithOk = Array.from(new Set(okItems.map(item => normalizeSectorName(item.setor))));
        const sectorsMissing = Array.from(new Set(missingItems.map(item => normalizeSectorName(item.setor))));
        const qtdOk = okItems.reduce((sum, item) => sum + normalizeQty(item.qtdPainel || 0), 0);
        const qtdFaltante = missingItems.reduce((sum, item) => sum + normalizeQty(item.qtdPainel || 0), 0);
        const faltas = missingItems
          .slice()
          .sort((a, b) => {
            const sectorDiff = getSectorOrderInsideGroup(a.setor) - getSectorOrderInsideGroup(b.setor);
            if (sectorDiff !== 0) return sectorDiff;
            return (a.dataPainel || '').localeCompare(b.dataPainel || '');
          })
          .map(item => `${normalizeSectorName(item.setor)} em ${formatToBRLDate(item.dataPainel || '')} - ${normalizeQty(item.qtdPainel || 0)} peça(s)`)
          .join(' | ');

        okItems.forEach(item => {
          item.status = PARTIAL_STATUS;
          item.observacao = `Este setor foi encontrado corretamente pela regra individual, mas o grupo produtivo ainda está incompleto. Grupo: ${linkedGroup.label}. Setores OK: ${sectorsWithOk.join(', ')}. Setores faltantes: ${sectorsMissing.join(', ')}. Programado no grupo: ${qtdOk} peça(s). Faltante no grupo: ${qtdFaltante} peça(s). Falta programar: ${faltas}.`;
        });
      });
    };

    applyPartialStatusByOpSector(results);
    applyPartialStatusByLinkedSectorGroup(results);

    results.sort((a, b) => {
      const statusOrder: Record<ValidationStatus, number> = { 'Não programado': 0, 'Programado parcial': 1, 'Data divergente': 2, 'Quantidade divergente': 3, Duplicado: 4, Extra: 5, OK: 6 };
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



  const SERIES_GROUPS = [
    { label: 'Tanque', sectors: ['Estamparia', 'Solda Tanque', 'Pintura Tanque'] },
    { label: 'Ferragem', sectors: ['Ferragem', 'Pintura Ferragem'] },
    { label: 'Núcleo', sectors: ['Corte Núcleo', 'Montagem Núcleo'] },
  ];

  const getSeriesGroup = (sector: string) => SERIES_GROUPS.find(group => group.sectors.includes(normalizeSectorName(sector)));
  const getSeriesKey = (row: SeriesRow) => `${normalizeOp(row.op)}|${row.serieInicial}|${row.serieFinal}`;
  const getSeriesActivityKey = (row: SeriesRow) => row.atividade || 'SEM_CODIGO';
  const getSeriesOrderGroupKey = (row: SeriesRow) => `${normalizeOp(row.op)}|${getSeriesActivityKey(row)}|${normalizeText(row.setor)}`;
  const formatSeriesRange = (row: SeriesRow) => `${row.serieInicial}-${row.serieFinal}`;
  const formatSeriesDateList = (rows: SeriesRow[]) => rows
    .slice()
    .sort((a, b) => a.data.localeCompare(b.data) || a.setor.localeCompare(b.setor))
    .map(row => `${formatToBRLDate(row.data)} - ${row.setor}`)
    .join(' | ');
  const formatDateSeriesSequence = (rows: SeriesRow[]) => rows
    .slice()
    .sort((a, b) => a.data.localeCompare(b.data) || a.serieInicial - b.serieInicial || a.serieFinal - b.serieFinal)
    .map(row => `${formatToBRLDate(row.data)}: ${formatSeriesRange(row)}`)
    .join(' | ');
  const formatRangeList = (rows: SeriesRow[]) => rows
    .slice()
    .sort((a, b) => a.serieInicial - b.serieInicial || a.serieFinal - b.serieFinal)
    .map(formatSeriesRange)
    .join(', ');
  const compareRangeLists = (left: SeriesRow[], right: SeriesRow[]) => {
    const leftRanges = left.map(formatSeriesRange).sort();
    const rightRanges = right.map(formatSeriesRange).sort();
    return leftRanges.length === rightRanges.length && leftRanges.every((range, index) => range === rightRanges[index]);
  };

  const addDateSeriesOrderErrors = (rowsToValidate: SeriesRow[], results: SeriesValidationResult[]) => {
    const rowsByOpActivitySector = new Map<string, SeriesRow[]>();

    rowsToValidate
      .filter(row => Number.isFinite(row.serieInicial) && Number.isFinite(row.serieFinal) && row.serieInicial > 0 && row.serieFinal > 0)
      .forEach(row => {
        const key = getSeriesOrderGroupKey(row);
        const list = rowsByOpActivitySector.get(key) || [];
        list.push(row);
        rowsByOpActivitySector.set(key, list);
      });

    rowsByOpActivitySector.forEach(groupRows => {
      const dates = Array.from(new Set(groupRows.map(row => row.data))).sort();
      if (dates.length < 2) return;

      const first = groupRows[0];
      const sortedBySeries = groupRows
        .slice()
        .sort((a, b) => a.serieInicial - b.serieInicial || a.serieFinal - b.serieFinal || a.data.localeCompare(b.data));

      let cursor = 0;
      dates.forEach(date => {
        const actualRows = groupRows
          .filter(row => row.data === date)
          .sort((a, b) => a.serieInicial - b.serieInicial || a.serieFinal - b.serieFinal);
        const expectedRows = sortedBySeries.slice(cursor, cursor + actualRows.length);
        cursor += actualRows.length;

        if (compareRangeLists(actualRows, expectedRows)) return;

        const activityLabel = first.atividade ? `Atividade ${first.atividade}` : 'Atividade não informada';
        results.push({
          status: 'Erro',
          op: normalizeOp(first.op),
          grupo: 'Ordem Data/Série',
          lote: formatRangeList(actualRows),
          setores: `${first.setor} / ${activityLabel}`,
          qtd: actualRows.reduce((sum, row) => sum + normalizeQty(row.qtd), 0),
          serieInicial: Math.min(...actualRows.map(row => row.serieInicial)),
          serieFinal: Math.max(...actualRows.map(row => row.serieFinal)),
          datas: `${formatToBRLDate(date)} | sequência: ${formatDateSeriesSequence(groupRows)}`,
          observacao: `Série inicial fora da ordem das datas. Atual nesta data: ${formatRangeList(actualRows)}. Esperado para esta posição: ${formatRangeList(expectedRows)}. Regra: a menor data deve receber a menor série inicial dentro da mesma OP, atividade e setor.`
        });
      });
    });
  };

  const buildSeriesValidationResults = (rows: SeriesRow[]) => {
    const results: SeriesValidationResult[] = [];
    const relevantRows = rows.filter(row => getSeriesGroup(row.setor));

    addDateSeriesOrderErrors(rows, results);

    relevantRows.forEach(row => {
      const tamanhoFaixa = row.serieFinal - row.serieInicial + 1;
      if (!Number.isFinite(row.serieInicial) || !Number.isFinite(row.serieFinal) || row.serieInicial <= 0 || row.serieFinal <= 0) {
        results.push({
          status: 'Erro', op: row.op, grupo: getSeriesGroup(row.setor)?.label || '-', lote: '-', setores: row.setor,
          qtd: row.qtd, serieInicial: row.serieInicial, serieFinal: row.serieFinal, datas: formatToBRLDate(row.data),
          observacao: 'Série inicial ou série final inválida.'
        });
      } else if (row.serieInicial > row.serieFinal) {
        results.push({
          status: 'Erro', op: row.op, grupo: getSeriesGroup(row.setor)?.label || '-', lote: `${row.serieInicial}-${row.serieFinal}`, setores: row.setor,
          qtd: row.qtd, serieInicial: row.serieInicial, serieFinal: row.serieFinal, datas: formatToBRLDate(row.data),
          observacao: 'Série inicial maior que a série final.'
        });
      } else if (normalizeQty(tamanhoFaixa) !== normalizeQty(row.qtd)) {
        results.push({
          status: 'Erro', op: row.op, grupo: getSeriesGroup(row.setor)?.label || '-', lote: `${row.serieInicial}-${row.serieFinal}`, setores: row.setor,
          qtd: row.qtd, serieInicial: row.serieInicial, serieFinal: row.serieFinal, datas: formatToBRLDate(row.data),
          observacao: `Quantidade incompatível com a faixa de série. A faixa possui ${tamanhoFaixa} peça(s), mas a linha está com ${row.qtd}.`
        });
      }
    });

    SERIES_GROUPS.forEach(group => {
      const rowsByOp = new Map<string, SeriesRow[]>();
      relevantRows.filter(row => group.sectors.includes(row.setor)).forEach(row => {
        const op = normalizeOp(row.op);
        const list = rowsByOp.get(op) || [];
        list.push(row);
        rowsByOp.set(op, list);
      });

      rowsByOp.forEach((opRows, op) => {
        const bySeries = new Map<string, SeriesRow[]>();
        opRows.forEach(row => {
          const key = getSeriesKey(row);
          const list = bySeries.get(key) || [];
          list.push(row);
          bySeries.set(key, list);
        });

        bySeries.forEach((serieRows, key) => {
          const first = serieRows[0];
          const sectorsFound = new Set(serieRows.map(row => row.setor));
          const missingSectors = group.sectors.filter(sector => !sectorsFound.has(sector));
          const duplicateSectors = group.sectors.filter(sector => serieRows.filter(row => row.setor === sector).length > 1);
          const qtds = Array.from(new Set(serieRows.map(row => normalizeQty(row.qtd))));
          const datesBySector = new Map<string, string>();
          serieRows.forEach(row => {
            if (!datesBySector.has(row.setor) || row.data < datesBySector.get(row.setor)!) datesBySector.set(row.setor, row.data);
          });
          const orderedDates = group.sectors.map(sector => datesBySector.get(sector)).filter(Boolean) as string[];
          const hasDateOrderError = orderedDates.some((date, index) => index > 0 && date < orderedDates[index - 1]);
          const setores = Array.from(sectorsFound).join(', ');
          const lote = `${first.serieInicial}-${first.serieFinal}`;

          if (missingSectors.length > 0) {
            results.push({
              status: 'Erro', op, grupo: group.label, lote, setores, qtd: first.qtd,
              serieInicial: first.serieInicial, serieFinal: first.serieFinal, datas: formatSeriesDateList(serieRows),
              observacao: `Esta faixa de série não apareceu em todos os setores do grupo. Setor(es) ausente(s): ${missingSectors.join(', ')}.`
            });
          }

          if (duplicateSectors.length > 0) {
            results.push({
              status: 'Erro', op, grupo: group.label, lote, setores, qtd: first.qtd,
              serieInicial: first.serieInicial, serieFinal: first.serieFinal, datas: formatSeriesDateList(serieRows),
              observacao: `A mesma faixa de série apareceu mais de uma vez no(s) setor(es): ${duplicateSectors.join(', ')}.`
            });
          }

          if (qtds.length > 1) {
            results.push({
              status: 'Erro', op, grupo: group.label, lote, setores, qtd: first.qtd,
              serieInicial: first.serieInicial, serieFinal: first.serieFinal, datas: formatSeriesDateList(serieRows),
              observacao: `A mesma faixa de série foi usada com quantidades diferentes: ${qtds.join(', ')}.`
            });
          }

          if (hasDateOrderError) {
            results.push({
              status: 'Erro', op, grupo: group.label, lote, setores, qtd: first.qtd,
              serieInicial: first.serieInicial, serieFinal: first.serieFinal, datas: formatSeriesDateList(serieRows),
              observacao: `A ordem das datas não segue o fluxo esperado: ${group.sectors.join(' → ')}.`
            });
          }

          if (missingSectors.length === 0 && duplicateSectors.length === 0 && qtds.length === 1 && !hasDateOrderError) {
            const hasRangeError = results.some(result => result.op === op && result.grupo === group.label && result.lote === lote && result.observacao.includes('Quantidade incompatível'));
            if (!hasRangeError) {
              results.push({
                status: 'OK', op, grupo: group.label, lote, setores: group.sectors.join(', '), qtd: first.qtd,
                serieInicial: first.serieInicial, serieFinal: first.serieFinal, datas: formatSeriesDateList(serieRows),
                observacao: 'Série consistente entre os setores do grupo.'
              });
            }
          }
        });

        const sortedRanges = Array.from(bySeries.values())
          .map(list => list[0])
          .sort((a, b) => a.serieInicial - b.serieInicial || a.serieFinal - b.serieFinal);
        for (let i = 1; i < sortedRanges.length; i += 1) {
          const previous = sortedRanges[i - 1];
          const current = sortedRanges[i];
          if (current.serieInicial <= previous.serieFinal && (current.serieInicial !== previous.serieInicial || current.serieFinal !== previous.serieFinal)) {
            results.push({
              status: 'Erro', op, grupo: group.label, lote: `${current.serieInicial}-${current.serieFinal}`, setores: '-', qtd: current.qtd,
              serieInicial: current.serieInicial, serieFinal: current.serieFinal, datas: '-',
              observacao: `Sobreposição de séries com a faixa ${previous.serieInicial}-${previous.serieFinal}.`
            });
          }
        }
      });
    });

    results.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'Erro' ? -1 : 1;
      return a.op.localeCompare(b.op, undefined, { numeric: true }) || a.grupo.localeCompare(b.grupo) || a.lote.localeCompare(b.lote, undefined, { numeric: true });
    });
    setSeriesValidationResults(results);
  };

  const handleSeriesFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorInfo(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result;
        const wb = XLSX.read(buffer, { type: 'array', cellDates: true, dateNF: 'dd/MM/yyyy' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const opAliases = ['OP-Pai', 'OP Pai', 'OPPAI', 'OP', 'Nro OP', 'NRO OP', 'Nro. OP'];
        const dateAliases = ['Dt.Programada', 'Dt Programada', 'Data Programada', 'DATA PROGRAMADA', 'DT PROGRAMADA', 'Dia', 'Data'];
        const sectorAliases = ['Descr.Atividade', 'Descr Atividade', 'Descricao Atividade', 'Descrição Atividade', 'Descrição (Atividade)', 'Descr. Atividade', 'Desc Atividade', 'Setor'];
        const codAliases = ['Atividade', 'Cod.Atividade', 'Cod Atividade', 'COD ATIVIDADE', 'Codigo Atividade', 'Cód. Atividade', 'Cód Atividade', 'Cod Sankhya', 'COD SANKHYA', 'Código Sankhya'];
        const qtdAliases = ['Qtd.Programada', 'Qtd Programada', 'Quantidade Programada', 'QTD PROGRAMADA', 'Qtd', 'Quantidade'];
        const serieInicialAliases = ['Série Inicial', 'Serie Inicial', 'SERIE INICIAL', 'Série Inicial ', 'Serie Inicial '];
        const serieFinalAliases = ['Série Final', 'Serie Final', 'SERIE FINAL', 'Série Final ', 'Serie Final '];
        const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', raw: false, dateNF: 'dd/MM/yyyy' });
        const headerRowIndex = findHeaderRowIndex(rows, [opAliases, dateAliases, [...sectorAliases, ...codAliases], qtdAliases, serieInicialAliases, serieFinalAliases]);
        if (headerRowIndex < 0) {
          setErrorInfo('Não encontrei as colunas necessárias. O arquivo precisa ter OP-Pai, Dt.Programada, Atividade/Descr.Atividade, Qtd.Programada, Série Inicial e Série Final.');
          setSeriesRows([]);
          setSeriesValidationResults([]);
          return;
        }
        const headers = rows[headerRowIndex];
        const parsedRows: SeriesRow[] = rows.slice(headerRowIndex + 1).map(row => {
          const opValue = getCellFromRowArray(headers, row, opAliases);
          const dateValue = getCellFromRowArray(headers, row, dateAliases);
          const sectorValue = getCellFromRowArray(headers, row, sectorAliases);
          const codValue = getCellFromRowArray(headers, row, codAliases);
          const setor = normalizeSectorName(mapCodToSetor(codValue, sectorValue));
          return {
            op: normalizeOp(opValue),
            data: parseExcelDate(dateValue) || '',
            setor,
            atividade: normalizeSankhyaCod(codValue),
            qtd: parseNumber(getCellFromRowArray(headers, row, qtdAliases)),
            serieInicial: parseNumber(getCellFromRowArray(headers, row, serieInicialAliases)),
            serieFinal: parseNumber(getCellFromRowArray(headers, row, serieFinalAliases)),
            rawSetor: String(sectorValue ?? '').trim()
          };
        }).filter(row => row.op && row.data && row.setor && row.qtd > 0);

        if (parsedRows.length === 0) {
          setErrorInfo('Encontrei o cabeçalho, mas nenhuma linha válida para validar séries.');
          setSeriesRows([]);
          setSeriesValidationResults([]);
          return;
        }

        const programacaoOps = new Set(
          (calculatedSteps.length > 0 ? calculatedSteps.map(step => step.op) : rawOPs.map(op => op.op))
            .map(op => normalizeOp(op))
            .filter(Boolean)
        );

        if (programacaoOps.size === 0) {
          setErrorInfo('Gere ou importe a programação antes de validar séries. A aba Validar Série só analisa OPs existentes na aba Programação.');
          setSeriesRows([]);
          setSeriesValidationResults([]);
          return;
        }

        const filteredRows = parsedRows.filter(row => programacaoOps.has(normalizeOp(row.op)));

        if (filteredRows.length === 0) {
          setErrorInfo('Nenhuma OP do arquivo de séries corresponde às OPs existentes na aba Programação.');
          setSeriesRows([]);
          setSeriesValidationResults([]);
          return;
        }

        setSeriesRows(filteredRows);
        buildSeriesValidationResults(filteredRows);
      } catch (error) {
        console.error(error);
        setErrorInfo('Não foi possível ler o arquivo de séries. Envie um .xls ou .xlsx válido.');
      }
    };
    reader.onerror = () => setErrorInfo('Erro ao carregar o arquivo de séries. Tente novamente.');
    reader.readAsArrayBuffer(file);
    if (seriesFileInputRef.current) seriesFileInputRef.current.value = '';
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
    const matchesDirectFilters = (step: OPStep, ignoreDate = false) => {
      if (!ignoreDate) {
        if (filters.dateStart && step.usedDate < filters.dateStart) return false;
        if (filters.dateEnd && step.usedDate > filters.dateEnd) return false;
      }
      if (filters.sector && !getSectorsForFilter(filters.sector).includes(step.stepName)) return false;
      if (filters.linha && step.linha !== filters.linha) return false;
      if (filters.op && !step.op.toLowerCase().includes(filters.op.toLowerCase())) return false;
      return true;
    };

    const directSteps = calculatedSteps.filter(step => matchesDirectFilters(step));

    if (!filters.sector || showOnlyErrors || showOnlyPartial) {
      return directSteps;
    }

    const opsInFilter = new Set(directSteps.map(step => step.op));
    if (opsInFilter.size === 0) return directSteps;

    return calculatedSteps.filter(step => opsInFilter.has(step.op) && matchesDirectFilters(step, true));
  }, [calculatedSteps, filters, showOnlyErrors, showOnlyPartial]);

  const sectorFilterOptions = useMemo(() => getSectorFilterOptions(), []);

  const defaultSortedSteps = useMemo(() => {
    const groupFirstDate = new Map<string, string>();
    filteredSteps.forEach(step => {
      const groupKey = getGroupedStepKey(step);
      const currentDate = groupFirstDate.get(groupKey);
      if (!currentDate || step.usedDate < currentDate) {
        groupFirstDate.set(groupKey, step.usedDate);
      }
    });

    return [...filteredSteps].sort((a, b) => {
      const opCompare = a.op.localeCompare(b.op, undefined, { numeric: true });
      if (opCompare !== 0) return opCompare;

      const qtyCompare = normalizeQty(a.qtd_mf) - normalizeQty(b.qtd_mf);
      if (qtyCompare !== 0) return qtyCompare;

      const dateA = groupFirstDate.get(getGroupedStepKey(a)) || a.usedDate;
      const dateB = groupFirstDate.get(getGroupedStepKey(b)) || b.usedDate;
      if (dateA !== dateB) return dateA.localeCompare(dateB);

      const groupCompare = getSectorGroupOrder(a.stepName) - getSectorGroupOrder(b.stepName);
      if (groupCompare !== 0) return groupCompare;

      const sectorOrderCompare = getSectorOrderInsideGroup(a.stepName) - getSectorOrderInsideGroup(b.stepName);
      if (sectorOrderCompare !== 0) return sectorOrderCompare;

      if (a.usedDate !== b.usedDate) return a.usedDate.localeCompare(b.usedDate);
      if (a.stepName !== b.stepName) return a.stepName.localeCompare(b.stepName);
      return a.linha.localeCompare(b.linha);
    });
  }, [filteredSteps]);


  const duplicateOpCounts = useMemo(() => {
    const counts = new Map<string, number>();
    defaultSortedSteps.forEach(step => {
      counts.set(step.op, (counts.get(step.op) || 0) + 1);
    });
    return counts;
  }, [defaultSortedSteps]);

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
    if (!showOnlyErrors && !showOnlyPartial) return validationResults;
    return validationResults.filter(result => {
      const isError = ERROR_STATUSES.includes(result.status);
      const isPartial = result.status === PARTIAL_STATUS;
      return (showOnlyErrors && isError) || (showOnlyPartial && isPartial);
    });
  }, [validationResults, showOnlyErrors, showOnlyPartial]);

  const validationCounts = useMemo(() => {
    return validationResults.reduce((acc, result) => {
      acc[result.status] = (acc[result.status] || 0) + 1;
      return acc;
    }, {} as Record<ValidationStatus, number>);
  }, [validationResults]);


  const visibleSeriesValidationResults = useMemo(() => {
    if (!showOnlySeriesErrors) return seriesValidationResults;
    return seriesValidationResults.filter(result => result.status === 'Erro');
  }, [seriesValidationResults, showOnlySeriesErrors]);

  const seriesValidationCounts = useMemo(() => {
    return seriesValidationResults.reduce((acc, result) => {
      acc[result.status] = (acc[result.status] || 0) + 1;
      return acc;
    }, {} as Record<SeriesValidationStatus, number>);
  }, [seriesValidationResults]);

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


  const baseDisplayedSteps = useMemo(() => {
    if (sankhyaRows.length === 0) return defaultSortedSteps;

    return defaultSortedSteps.filter(step => {
      const status = getMainValidationInfo(step)?.status;
      if (!status) return false;
      const isError = ERROR_STATUSES.includes(status);
      const isPartial = status === PARTIAL_STATUS;

      if (showOnlyErrors || showOnlyPartial) {
        return (showOnlyErrors && isError) || (showOnlyPartial && isPartial);
      }

      return true;
    });
  }, [defaultSortedSteps, showOnlyErrors, showOnlyPartial, sankhyaRows.length, validationByPanelKey]);

  const compareValues = (a: string | number, b: string | number) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  };

  const compareOpDateOrder = (a: OPStep, b: OPStep) => {
    const opCompare = a.op.localeCompare(b.op, undefined, { numeric: true, sensitivity: 'base' });
    if (opCompare !== 0) return opCompare;

    const dateCompare = a.usedDate.localeCompare(b.usedDate);
    if (dateCompare !== 0) return dateCompare;

    const groupCompare = getSectorGroupOrder(a.stepName) - getSectorGroupOrder(b.stepName);
    if (groupCompare !== 0) return groupCompare;

    const sectorOrderCompare = getSectorOrderInsideGroup(a.stepName) - getSectorOrderInsideGroup(b.stepName);
    if (sectorOrderCompare !== 0) return sectorOrderCompare;

    const qtdCompare = normalizeQty(a.qtd_mf) - normalizeQty(b.qtd_mf);
    if (qtdCompare !== 0) return qtdCompare;

    return a.stepName.localeCompare(b.stepName, undefined, { numeric: true, sensitivity: 'base' }) || a.linha.localeCompare(b.linha, undefined, { numeric: true, sensitivity: 'base' });
  };

  const getSortValue = (step: OPStep, key: SortKey): string | number => {
    if (key === 'op') return step.op;
    if (key === 'usedDate') return step.usedDate;
    if (key === 'qtd_mf') return normalizeQty(step.qtd_mf);
    if (key === 'stepName') return step.stepName;
    if (key === 'linha') return step.linha || '';
    if (key === 'status') return getMainValidationInfo(step)?.status || 'Sem validação';
    return '';
  };

  const displayedSteps = useMemo(() => {
    if (!sortConfig) return baseDisplayedSteps;

    return [...baseDisplayedSteps].sort((a, b) => {
      if (sortConfig.key === 'opDate') return compareOpDateOrder(a, b);

      const primary = compareValues(getSortValue(a, sortConfig.key), getSortValue(b, sortConfig.key));
      const direction = sortConfig.direction === 'asc' ? 1 : -1;
      if (primary !== 0) return primary * direction;
      return a.op.localeCompare(b.op, undefined, { numeric: true }) || a.usedDate.localeCompare(b.usedDate) || a.stepName.localeCompare(b.stepName);
    });
  }, [baseDisplayedSteps, sortConfig, validationByPanelKey, sankhyaRows.length]);

  const handleSort = (key: SortKey) => {
    setSortConfig(current => {
      if (!current || current.key !== key) return { key, direction: 'asc' };
      if (current.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  };

  const handleAutoOpDateSort = () => {
    setSortConfig({ key: 'opDate', direction: 'asc' });
  };

  const isAutoOpDateSortActive = sortConfig?.key === 'opDate';

  const getSortIndicator = (key: SortKey) => {
    if (!sortConfig || sortConfig.key !== key) return '↕';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const renderSortableHeader = (label: string, key: SortKey, className = '') => (
    <th className={`font-bold ${className}`}>
      <button
        type="button"
        onClick={() => handleSort(key)}
        className="tab-button flex items-center gap-2 rounded-md text-left transition-colors hover:text-brand-accent"
        title={`Ordenar por ${label}`}
      >
        <span>{label}</span>
        <span className="text-sm text-brand-accent/80">{getSortIndicator(key)}</span>
      </button>
    </th>
  );

  
  const dashboardStats = useMemo(() => {
    const grouped = new Map<string, DashboardGroupStats>();

    displayedSteps.forEach(step => {
      const group = getSectorGroupLabel(step.stepName);
      const validationInfo = getMainValidationInfo(step);
      const bucket = getDashboardBucket(validationInfo?.status ?? 'Sem validação');

      if (!grouped.has(group)) {
        grouped.set(group, createEmptyDashboardStats());
      }

      grouped.get(group)![bucket] += 1;
    });

    return Array.from(grouped.entries()).map(([group, stats]) => ({ group, stats }));
  }, [displayedSteps, validationResults, sankhyaRows.length]);

const rowVisualInfo = useMemo(() => {
    const groupSequence = new Map<string, number>();
    const firstRowByGroup = new Map<string, string>();
    const info = new Map<string, { isFirstInGroup: boolean; toneClass: string }>();

    displayedSteps.forEach(step => {
      const groupKey = getGroupedStepKey(step);
      const rowKey = getRowKey(step);

      if (!groupSequence.has(groupKey)) {
        groupSequence.set(groupKey, groupSequence.size);
        firstRowByGroup.set(groupKey, rowKey);
      }

      const groupIndex = groupSequence.get(groupKey) || 0;
       info.set(rowKey, {
         isFirstInGroup: firstRowByGroup.get(groupKey) === rowKey,
         toneClass: groupIndex % 2 === 0 ? 'bg-brand-card/40' : 'bg-brand-panel/65'
       });
    });

    return info;
  }, [displayedSteps]);

  const totalOpsUnique = new Set(displayedSteps.map(s => s.op)).size;
  const totalSectors = new Set(displayedSteps.map(s => s.stepName)).size;
  const totalDates = new Set(displayedSteps.map(s => s.usedDate)).size;
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="app-shell flex h-dvh min-h-[520px] w-full flex-col overflow-hidden font-sans">
      <header className="relative z-10 shrink-0 border-b border-brand-border bg-brand-panel/95 px-3 py-2 backdrop-blur sm:px-4">
        <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/70 to-transparent" />
        <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-accent/25 bg-brand-accent/10 text-brand-accent">
              <Factory className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-muted">ITAM / PCP</p>
              <h1 className="truncate text-base font-bold tracking-tight text-white sm:text-lg">
                Programação de <span className="text-brand-accent">Produção</span>
              </h1>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <input 
            type="file" 
            accept=".xlsx,.xls" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileUpload}
          />
          <button 
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="ui-button ui-button-secondary"
          >
            <Upload className="h-4 w-4 text-brand-accent" /> Importar Excel
          </button>
          <button 
            type="button"
            onClick={() => setIsCalendarOpen(true)}
            className="ui-button ui-button-secondary"
          >
            <CalendarIcon className="h-4 w-4 text-brand-accent" /> Calendário
          </button>
          <button 
            type="button"
            onClick={openValidationModal}
            className="ui-button ui-button-secondary"
          >
            <FileCheck2 className="h-4 w-4 text-brand-accent" /> Validar
          </button>
          <button 
            type="button"
            onClick={handleOpenTestModal}
            className="ui-button ui-button-secondary"
          >
            <FlaskConical className="h-4 w-4 text-brand-accent" /> Simular
          </button>
          <button 
            type="button"
            onClick={handleGenerate}
            className="ui-button ui-button-primary col-span-2 sm:col-span-1"
          >
            <Zap className="h-4 w-4" /> Gerar Programação
          </button>
        </div>
        </div>
      </header>

      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-brand-border bg-brand-border lg:grid-cols-4">
        <StatCard label="Total de OPs" value={totalOpsUnique || '-'} accent />
        <StatCard label="Etapas Programadas" value={displayedSteps.length || '-'} />
        <StatCard label="Setores Ativos" value={totalSectors} />
        <StatCard label="Datas do Ciclo" value={totalDates || '-'} />
      </div>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="hidden w-[224px] shrink-0 flex-col overflow-y-auto border-r border-brand-border bg-brand-panel/45 p-3 lg:flex">
          <FilterBar 
            filters={filters} 
            setFilters={setFilters} 
            sectors={sectorFilterOptions} 
          />
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-border bg-brand-panel/55 px-3 py-2 sm:px-4">
            <div role="tablist" aria-label="Visualização da programação" className="flex items-center gap-1 rounded-xl border border-brand-border bg-brand-panel p-1">
              <button type="button" role="tab" aria-selected={activeTab === 'programacao'} onClick={() => setActiveTab('programacao')} className={`tab-button flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${activeTab === 'programacao' ? 'bg-brand-accent text-black' : 'text-brand-soft hover:bg-brand-surface hover:text-white'}`}>
                <List className="h-4 w-4" /> Programação
              </button>
              <button type="button" role="tab" aria-selected={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} className={`tab-button flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${activeTab === 'dashboard' ? 'bg-brand-accent text-black' : 'text-brand-soft hover:bg-brand-surface hover:text-white'}`}>
                <BarChart3 className="h-4 w-4" /> Dashboard
              </button>
              <button type="button" role="tab" aria-selected={activeTab === 'validarSerie'} onClick={() => setActiveTab('validarSerie')} className={`tab-button flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${activeTab === 'validarSerie' ? 'bg-brand-accent text-black' : 'text-brand-soft hover:bg-brand-surface hover:text-white'}`}>
                <FileCheck2 className="h-4 w-4" /> Validar Série
              </button>
            </div>

            <button
              type="button"
              className="ui-button ui-button-secondary lg:hidden"
              onClick={() => setIsMobileFiltersOpen(current => !current)}
              aria-controls="mobile-filters"
              aria-expanded={isMobileFiltersOpen}
            >
              <SlidersHorizontal className="h-4 w-4 text-brand-accent" />
              Filtros
              {activeFilterCount > 0 && <span className="rounded-full bg-brand-accent px-1.5 py-0.5 text-[10px] font-bold text-black">{activeFilterCount}</span>}
            </button>
          </div>

          {isMobileFiltersOpen && (
            <aside id="mobile-filters" className="max-h-[55vh] shrink-0 overflow-y-auto border-b border-brand-border bg-brand-card p-4 lg:hidden">
              <FilterBar filters={filters} setFilters={setFilters} sectors={sectorFilterOptions} />
            </aside>
          )}

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-brand-border px-3 py-2 sm:px-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-brand-muted">Agenda de produção</p>
              <p className="mt-1 text-xs text-brand-soft">
                {displayedSteps.length} etapa(s) exibida(s)
                {activeFilterCount > 0 && ` / ${activeFilterCount} filtro(s) ativo(s)`}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {sankhyaRows.length > 0 && (
                <>
                  <label className="flex items-center gap-2 rounded-lg border border-brand-border bg-brand-card px-3 py-2 text-xs font-semibold text-white">
                    <input type="checkbox" checked={showOnlyErrors} onChange={(e) => setShowOnlyErrors(e.target.checked)} className="h-4 w-4 accent-[#00EE76]" />
                    Exibir erros
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-brand-border bg-brand-card px-3 py-2 text-xs font-semibold text-white">
                    <input type="checkbox" checked={showOnlyPartial} onChange={(e) => setShowOnlyPartial(e.target.checked)} className="h-4 w-4 accent-[#00EE76]" />
                    Programado parcial
                  </label>
                </>
              )}
              <button
                type="button"
                onClick={handleAutoOpDateSort}
                className={`ui-button ${isAutoOpDateSortActive ? 'ui-button-primary' : 'ui-button-secondary'}`}
                title="Ordenar automaticamente por OP e data crescente, sem alterar os dados da programação"
              >
                <ArrowUpDown className={`h-4 w-4 ${isAutoOpDateSortActive ? '' : 'text-brand-accent'}`} />
                Ordem OP/Data
              </button>
              <span className="rounded-lg border border-brand-border/70 bg-brand-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-brand-muted">{filters.dateStart || filters.dateEnd ? `${filters.dateStart ? formatToBRLDate(filters.dateStart) : 'Início'} até ${filters.dateEnd ? formatToBRLDate(filters.dateEnd) : 'Fim'}` : 'Todas as datas'}</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">

            {activeTab === 'validarSerie' ? (
              <div className="flex h-full flex-col overflow-hidden">
                <div className="flex shrink-0 flex-col gap-4 border-b border-brand-border bg-brand-panel/35 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-brand-muted">Validação de séries</p>
                      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-brand-soft">
                        Importe o relatório com OP-Pai, Dt.Programada, Atividade/Descr.Atividade, Qtd.Programada, Série Inicial e Série Final. A validação confere a ordem Data/Série por OP + atividade + setor e mantém as regras de Tanque, Ferragem e Núcleo sem alterar a programação existente.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-2 rounded-lg border border-brand-accent/30 bg-brand-accent/10 px-2.5 py-1.5 text-[11px] font-semibold text-brand-accent"><span className="h-1.5 w-1.5 rounded-full bg-current" />OK <span className="rounded-md bg-black/15 px-1.5 py-0.5 font-mono font-bold">{seriesValidationCounts.OK || 0}</span></span>
                      <span className="inline-flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-300"><span className="h-1.5 w-1.5 rounded-full bg-current" />Erro <span className="rounded-md bg-black/15 px-1.5 py-0.5 font-mono font-bold">{seriesValidationCounts.Erro || 0}</span></span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 rounded-xl border border-brand-border/80 bg-brand-card p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <input type="file" accept=".xls,.xlsx" className="hidden" ref={seriesFileInputRef} onChange={handleSeriesFileUpload} />
                      <button type="button" onClick={() => seriesFileInputRef.current?.click()} className="ui-button ui-button-primary">
                        <Upload className="h-4 w-4" />
                        Importar arquivo de séries
                      </button>
                      <span className="text-brand-muted text-xs">Linhas importadas: {seriesRows.length || 0}</span>
                    </div>
                    <label className="flex items-center gap-2 rounded-lg border border-brand-border bg-brand-panel px-3 py-2 text-xs font-semibold text-white">
                      <input type="checkbox" checked={showOnlySeriesErrors} onChange={(e) => setShowOnlySeriesErrors(e.target.checked)} className="h-4 w-4 accent-[#00EE76]" />
                      Exibir somente erros
                    </label>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
                  <div className="panel-shadow h-full overflow-auto rounded-2xl border border-brand-border bg-brand-card/60">
                    {seriesValidationResults.length === 0 ? (
                      <EmptyState compact icon={FileCheck2} title="Nenhum arquivo validado" description="Importe o arquivo extraído do sistema para verificar se a menor data está com a menor série inicial e se as séries estão corretas nos grupos Tanque, Ferragem e Núcleo." />
                    ) : visibleSeriesValidationResults.length === 0 ? (
                      <EmptyState compact icon={Check} title="Nenhum erro encontrado" description="Todas as séries visíveis estão consistentes com as regras aplicadas." />
                    ) : (
                      <table className="min-w-[1180px] w-full border-collapse">
                        <thead className="sticky top-0 z-10 border-b border-brand-border bg-brand-panel">
                          <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-brand-muted">
                            <th className="p-3 px-4 font-bold w-[110px]">Status</th>
                            <th className="p-3 px-4 font-bold w-[95px]">OP</th>
                            <th className="p-3 px-4 font-bold w-[120px]">Grupo</th>
                            <th className="p-3 px-4 font-bold w-[150px]">Série</th>
                            <th className="p-3 px-4 font-bold w-[80px]">QTD</th>
                            <th className="p-3 px-4 font-bold">Setores</th>
                            <th className="p-3 px-4 font-bold">Datas</th>
                            <th className="p-3 px-4 font-bold">Resultado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleSeriesValidationResults.map((result, index) => (
                            <tr key={`${result.status}_${result.op}_${result.grupo}_${result.lote}_${index}`} className="border-b border-brand-border/70 transition-colors hover:bg-brand-surface/60">
                              <td className="p-3 px-4">
                                <span className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${result.status === 'OK' ? 'border-brand-accent/30 bg-brand-accent/10 text-brand-accent' : 'border-red-400/30 bg-red-400/10 text-red-300'}`}>
                                  <span className="h-1.5 w-1.5 rounded-full bg-current" />{result.status}
                                </span>
                              </td>
                              <td className="p-3 px-4 font-mono font-bold text-brand-accent">{result.op}</td>
                              <td className="p-3 px-4 text-sm font-semibold text-white">{result.grupo}</td>
                              <td className="p-3 px-4 font-mono text-white">{result.lote}</td>
                              <td className="p-3 px-4 font-mono text-white">{result.qtd ?? '-'}</td>
                              <td className="p-3 px-4 text-xs text-brand-soft">{result.setores}</td>
                              <td className="p-3 px-4 text-xs text-brand-muted">{result.datas}</td>
                              <td className="p-3 px-4 text-xs text-brand-muted">{result.observacao}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            ) : activeTab === 'dashboard' ? (
              displayedSteps.length === 0 ? (
                <EmptyState
                  icon={BarChart3}
                  title="Dashboard sem dados para exibir"
                  description={calculatedSteps.length === 0 ? 'Importe o arquivo e gere a programação para visualizar indicadores por setor.' : 'Ajuste os filtros para visualizar os indicadores disponíveis.'}
                />
              ) : (
                <div className="dashboard-table-scroll h-full overflow-auto p-3">
                  <div className="panel-shadow overflow-hidden rounded-2xl border border-brand-border bg-brand-card/70">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border bg-brand-panel/80 px-4 py-3">
                      <div>
                        <h2 className="text-sm font-bold text-white">Resumo por setor</h2>
                        <p className="text-[11px] text-brand-muted">Visualização compacta com os mesmos status e filtros da programação.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        {DASHBOARD_BUCKETS.map(bucket => (
                          <div key={bucket.key} className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-soft" title={bucket.description}>
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: bucket.color }} />
                            {bucket.label}
                          </div>
                        ))}
                      </div>
                    </div>

                    <table className="dashboard-summary-table w-full min-w-[1120px] border-collapse">
                      <thead className="sticky top-0 z-10 border-b border-brand-border bg-brand-panel">
                        <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-brand-muted">
                          <th className="px-4 py-3 font-bold">Setor</th>
                          <th className="px-4 py-3 text-right font-bold">Total</th>
                          {DASHBOARD_BUCKETS.map(bucket => (
                            <th key={bucket.key} className="px-4 py-3 text-right font-bold">{bucket.label}</th>
                          ))}
                          <th className="px-4 py-3 font-bold">Progresso</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardStats.map(item => {
                          const total = Object.values(item.stats).reduce<number>((a, b) => a + Number(b), 0);
                          const conformePct = total ? (Number(item.stats.conforme) / total) * 100 : 0;

                          return (
                            <tr key={item.group} className="border-b border-brand-border/60 transition-colors hover:bg-brand-surface/55">
                              <td className="px-4 py-3">
                                <div className="flex min-w-0 items-center gap-3">
                                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
                                    <Factory className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-bold text-white" title={item.group}>{item.group}</p>
                                    <p className="text-[10px] text-brand-muted">{total} registros analisados</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-base font-bold text-white">{total}</td>
                              {DASHBOARD_BUCKETS.map(bucket => {
                                const value = Number(item.stats[bucket.key]);
                                const pct = total ? (value / total) * 100 : 0;

                                return (
                                  <td key={bucket.key} className="px-4 py-3 text-right font-mono text-xs text-brand-soft">
                                    <span className="font-bold text-white">{value}</span>
                                    <span className="ml-1 text-brand-muted">({pct.toFixed(1).replace('.', ',')}%)</span>
                                  </td>
                                );
                              })}
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <div className="h-3 min-w-[180px] flex-1 overflow-hidden rounded-full bg-brand-surface shadow-inner">
                                    <div className="flex h-full w-full">
                                      {DASHBOARD_BUCKETS.map(bucket => {
                                        const value = Number(item.stats[bucket.key]);
                                        const pct = total ? (value / total) * 100 : 0;
                                        return value > 0 ? (
                                          <span
                                            key={bucket.key}
                                            className="h-full"
                                            style={{ width: `${pct}%`, backgroundColor: bucket.color }}
                                            title={`${bucket.label}: ${value} (${pct.toFixed(1).replace('.', ',')}%)`}
                                          />
                                        ) : null;
                                      })}
                                    </div>
                                  </div>
                                  <span className="w-14 text-right font-mono text-xs font-bold text-brand-soft">{conformePct.toFixed(0)}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            ) : displayedSteps.length === 0 ? (
              <EmptyState
                icon={rawOPs.length === 0 ? FileSpreadsheet : calculatedSteps.length === 0 ? CalendarIcon : SlidersHorizontal}
                title={rawOPs.length === 0 ? 'Importe ordens para começar' : calculatedSteps.length === 0 ? 'Programação pronta para ser gerada' : 'Nenhuma etapa encontrada'}
                description={rawOPs.length === 0 ? 'Importe um Excel com OP, linha, data de montagem final e quantidade.' : calculatedSteps.length === 0 ? 'Clique em Gerar Programação para calcular as etapas de produção.' : 'Revise os filtros aplicados ou a exibição de validações.'}
              />
            ) : (
              <div className="h-full p-3 sm:p-4">
                <div className="panel-shadow h-full overflow-auto rounded-2xl border border-brand-border bg-brand-card/60">
              <table className="programacao-table border-collapse">
                <thead className="sticky top-0 z-10 border-b border-brand-border bg-brand-panel">
                  <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-brand-muted">
                    {renderSortableHeader('OP', 'op', 'w-[18%]')}
                    {renderSortableHeader('Data Programada', 'usedDate', 'w-[18%]')}
                    {renderSortableHeader('QTD', 'qtd_mf', 'w-[8%]')}
                    {renderSortableHeader('Setor', 'stepName', 'w-[31%]')}
                    {renderSortableHeader('Linha', 'linha', 'w-[10%]')}
                    {renderSortableHeader('Status', 'status', 'w-[15%]')}
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
                    const rowVisual = rowVisualInfo.get(rowKey);
                    const groupBgClass = rowVisual?.toneClass || 'bg-brand-bg';
                    const groupBorderClass = rowVisual?.isFirstInGroup ? 'border-l-brand-accent' : 'border-l-transparent';
                    return (
                      <tr 
                        key={`${step.id}_${step.data_mf}_${index}`}
                        className={`border-b border-brand-border/70 border-l-[3px] border-r-[3px] transition-colors ${
                          isRowCopied
                            ? 'border-l-brand-accent border-r-brand-accent bg-brand-accent/12 shadow-[inset_0_0_0_1px_rgba(0,238,118,0.28)]'
                            : `${groupBgClass} ${groupBorderClass} border-r-transparent hover:border-l-brand-accent hover:bg-brand-surface/75`
                        }`}
                      >
                        <td>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm font-bold text-brand-accent">{step.op}</span>
                            {isDuplicateOp && (
                              <span className="rounded-full border border-brand-border bg-brand-surface px-2 py-0.5 text-[10px] font-bold text-brand-soft" title="OP aparece em mais de uma linha">
                                {duplicateCount}x
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => copyValue(step.op, 'OP', rowKey)}
                              className="ui-icon-button h-8 w-8"
                              title="Copiar OP"
                              aria-label={`Copiar OP ${step.op}`}
                            >
                              {isCopiedOP ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-3">
                            <span className="rounded-lg border border-brand-accent/25 bg-brand-accent/10 px-3 py-1.5 font-mono text-sm font-bold text-white">{formattedDate}</span>
                            <button
                              type="button"
                              onClick={() => copyValue(formattedDate, 'DATA', rowKey)}
                              className="ui-icon-button h-8 w-8"
                              title="Copiar Data"
                              aria-label={`Copiar Data ${formattedDate}`}
                            >
                              {isCopiedDATA ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                        <td>
                          <span className="font-mono text-sm font-bold text-white">{step.qtd_mf}</span>
                        </td>
                        <td className="text-[13px] font-medium text-white">
                          <div className="flex flex-col gap-1">
                            <span>{step.stepName}</span>
                            {getSectorSankhyaCodes(step.stepName).length > 0 && (
                              <span className="text-[10px] font-bold tracking-wide text-brand-muted">
                                Cód. Sankhya: {getSectorSankhyaCodes(step.stepName).join(' / ')}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="rounded-md border border-brand-border bg-brand-surface px-2 py-1 text-[11px] font-semibold text-brand-soft">{step.linha || '-'}</span>
                        </td>
                        <td>
                          {validationInfo ? (
                            <StatusBadge status={validationInfo.status} title={validationInfo.observacao} />
                          ) : (
                            <StatusBadge status="Sem validação" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
                </div>
              </div>
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
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="validation-modal-title" className="panel-shadow flex max-h-[92vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-brand-border bg-brand-card">
            <div className="flex items-start justify-between gap-4 border-b border-brand-border px-4 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
                  <FileCheck2 className="h-5 w-5" />
                </span>
                <div>
                  <h2 id="validation-modal-title" className="text-lg font-bold tracking-tight text-white">Validar programação</h2>
                  <p className="mt-1 text-xs text-brand-muted">Importe o relatório do Sankhya para comparar com a programação calculada pelo painel.</p>
                </div>
              </div>
              <button type="button" onClick={() => setIsValidationModalOpen(false)} className="ui-icon-button" aria-label="Fechar validação">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-4 border-b border-brand-border bg-brand-panel/35 p-4 sm:p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status="OK" count={validationCounts.OK || 0} />
                  <StatusBadge status="Programado parcial" count={validationCounts['Programado parcial'] || 0} />
                  <StatusBadge status="Não programado" count={validationCounts['Não programado'] || 0} />
                  <StatusBadge status="Data divergente" count={validationCounts['Data divergente'] || 0} />
                  <StatusBadge status="Quantidade divergente" count={validationCounts['Quantidade divergente'] || 0} />
                  <StatusBadge status="Extra" count={validationCounts.Extra || 0} />
                  <StatusBadge status="Duplicado" count={validationCounts.Duplicado || 0} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="flex items-center gap-2 rounded-lg border border-brand-border bg-brand-card px-3 py-2 text-xs font-semibold text-white">
                    <input type="checkbox" checked={showOnlyErrors} onChange={(e) => setShowOnlyErrors(e.target.checked)} className="h-4 w-4 accent-[#00EE76]" />
                    Exibir erros
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-brand-border bg-brand-card px-3 py-2 text-xs font-semibold text-white">
                    <input type="checkbox" checked={showOnlyPartial} onChange={(e) => setShowOnlyPartial(e.target.checked)} className="h-4 w-4 accent-[#00EE76]" />
                    Programado parcial
                  </label>
                </div>
              </div>
              <div className="flex flex-col gap-3 rounded-xl border border-brand-border/80 bg-brand-card p-3 sm:flex-row sm:items-center">
                <input type="file" accept=".xls,.xlsx" className="hidden" ref={validationFileInputRef} onChange={handleValidationFileUpload} />
                <button type="button" onClick={() => validationFileInputRef.current?.click()} className="ui-button ui-button-primary">
                  <Upload className="h-4 w-4" />
                  Importar relatório do Sankhya
                </button>
                <span className="text-brand-muted text-xs">Regra usada: OP + Data Programada + Setor + QTD. Linhas importadas: {sankhyaRows.length || 0}</span>
              </div>
            </div>
            <div className="min-h-[180px] flex-1 overflow-auto">
              {validationResults.length === 0 ? (
                <EmptyState compact icon={FileCheck2} title="Nenhuma validação executada" description="Importe o relatório do Sankhya para iniciar a conferência." />
              ) : visibleValidationResults.length === 0 ? (
                <EmptyState compact icon={Check} title="Nenhum item no filtro atual" description="Não há divergências visíveis com os filtros de validação selecionados." />
              ) : (
                <table className="min-w-[1050px] w-full border-collapse">
                  <thead className="sticky top-0 z-10 border-b border-brand-border bg-brand-panel">
                    <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-brand-muted">
                      <th className="p-3 px-4 font-bold w-[166px]">Status</th><th className="p-3 px-4 font-bold w-[100px]">OP</th><th className="p-3 px-4 font-bold w-[130px]">Data Painel</th><th className="p-3 px-4 font-bold w-[135px]">Data Sankhya</th><th className="p-3 px-4 font-bold">Setor</th><th className="p-3 px-4 font-bold w-[100px]">QTD Painel</th><th className="p-3 px-4 font-bold w-[115px]">QTD Sankhya</th><th className="p-3 px-4 font-bold">Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleValidationResults.map((result, index) => {
                      return (
                        <tr key={result.status + '_' + result.op + '_' + result.setor + '_' + index} className="border-b border-brand-border/70 transition-colors hover:bg-brand-surface/60">
                          <td className="p-3 px-4"><StatusBadge status={result.status} /></td>
                          <td className="p-3 px-4 font-mono text-brand-accent font-bold">{result.op}</td>
                          <td className="p-3 px-4 font-mono text-white">{result.dataPainel ? formatToBRLDate(result.dataPainel) : '-'}</td>
                          <td className="p-3 px-4 font-mono text-white">{result.dataSistema ? formatToBRLDate(result.dataSistema) : '-'}</td>
                          <td className="p-3 px-4 text-white text-sm">
                            <div className="flex flex-col gap-1">
                              <span>{result.setor}</span>
                              {getSectorSankhyaCodes(result.setor).length > 0 && (
                                <span className="text-[10px] font-bold tracking-wide text-brand-muted">
                                  Cód. Sankhya: {getSectorSankhyaCodes(result.setor).join(' / ')}
                                </span>
                              )}
                            </div>
                          </td>
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
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="test-modal-title" className="panel-shadow flex max-h-[92vh] w-full max-w-[650px] flex-col overflow-hidden rounded-2xl border border-brand-border bg-brand-card">
            <div className="flex items-start justify-between gap-4 border-b border-brand-border px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
                  <FlaskConical className="h-5 w-5" />
                </span>
                <div>
                  <h2 id="test-modal-title" className="text-lg font-bold tracking-tight text-white">Testar programação</h2>
                  <p className="mt-1 text-xs text-brand-muted">Simula as datas sem adicionar nada à lista principal.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseTestModal}
                className="ui-icon-button"
                aria-label="Fechar simulação"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-brand-border bg-brand-panel/35 p-5">
              <label htmlFor="simulation-mf-date" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-brand-muted">
                Data da Montagem Final
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="simulation-mf-date"
                  type="date"
                  value={testMfDate}
                  onChange={(e) => setTestMfDate(e.target.value)}
                  className="ui-field flex-1"
                />
                <button
                  type="button"
                  onClick={handleRunTestProgramming}
                  className="ui-button ui-button-primary px-5"
                >
                  Simular datas
                </button>
              </div>
              <p className="mt-3 text-xs text-brand-muted">
                O cálculo usa o calendário atual, incluindo dias bloqueados e dias extras liberados.
              </p>
            </div>

            <div className="min-h-[150px] flex-1 overflow-auto">
              {testSteps.length === 0 ? (
                <EmptyState compact icon={FlaskConical} title="Aguardando uma data" description="Informe a data da Montagem Final para visualizar a simulação." />
              ) : (
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 border-b border-brand-border bg-brand-panel">
                    <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-brand-muted">
                      <th className="p-3 px-5 font-bold">Setor</th>
                      <th className="p-3 px-5 font-bold w-[190px]">Data Programada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testSteps.map((step) => (
                      <tr key={step.id} className="border-b border-brand-border/70 transition-colors hover:bg-brand-surface/60">
                        <td className="p-3 px-5 text-white text-sm font-medium">
                          <div className="flex flex-col gap-1">
                            <span>{step.stepName}</span>
                            {getSectorSankhyaCodes(step.stepName).length > 0 && (
                              <span className="text-[10px] font-bold tracking-wide text-brand-muted">
                                Cód. Sankhya: {getSectorSankhyaCodes(step.stepName).join(' / ')}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 px-5">
                          <span className="rounded-lg border border-brand-accent/25 bg-brand-accent/10 px-3 py-1.5 font-mono text-sm font-bold text-white">
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
        <div role="alert" className="panel-shadow fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-red-400/25 bg-[#241317] px-4 py-3 text-sm font-semibold text-red-200">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-400/15 text-red-300">!</span>
          {errorInfo}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, title, count }: { status: DisplayStatus; title?: string; count?: number }) {
  return (
    <span title={title} className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${STATUS_BADGE_CLASSES[status]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
      {count !== undefined && <span className="rounded-md bg-black/15 px-1.5 py-0.5 font-mono font-bold">{count}</span>}
    </span>
  );
}

function EmptyState({ icon: Icon, title, description, compact = false }: { icon: React.ElementType<{ className?: string }>; title: string; description: string; compact?: boolean }) {
  return (
    <div className={`flex h-full flex-col items-center justify-center px-6 text-center ${compact ? 'min-h-[180px] py-8' : 'py-16'}`}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-border bg-brand-card text-brand-muted">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-brand-muted">{description}</p>
    </div>
  );
}

function StatCard({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="flex min-h-[56px] flex-col justify-center bg-brand-panel/75 px-4 py-2 sm:px-5">
      <span className="mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-brand-muted">{label}</span>
      <span className={`font-mono text-xl font-bold tracking-tight ${accent ? 'text-brand-accent' : 'text-white'}`}>{value}</span>
    </div>
  );
}
