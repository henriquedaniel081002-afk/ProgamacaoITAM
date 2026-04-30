import { addDays, format, isValid, parse, parseISO, subDays } from 'date-fns';

export interface RawOP {
  op: string;
  linha: string;
  data_mf: string; // YYYY-MM-DD
  qtd_mf: number;
}

export interface OPStep {
  id: string; // chave estável baseada em OP + data calculada + setor
  op: string;
  linha: string;
  qtd_mf: number;
  data_mf: string;
  stepName: string;
  calculatedDate: string; // YYYY-MM-DD
  manualDate?: string; // YYYY-MM-DD
  usedDate: string; // YYYY-MM-DD
}

export interface ValidDaysConfig {
  invalidDays: string[]; // specifically unmarked days (YYYY-MM-DD)
  extraValidDays: string[]; // specifically marked weekends (YYYY-MM-DD)
}

export const PRODUCTION_STEPS = [
  { name: 'Montagem Final', offsetDays: 0 },
  { name: 'Pintura Tanque', offsetDays: 1 },
  { name: 'MPA', offsetDays: 1 },
  { name: 'Solda Tanque', offsetDays: 2 },
  { name: 'Bobinagem AT', offsetDays: 3 },
  { name: 'Montagem Núcleo', offsetDays: 3 },
  { name: 'Estamparia', offsetDays: 4 },
  { name: 'Pintura Ferragem', offsetDays: 5 },
  { name: 'Bobinagem BT', offsetDays: 5 },
  { name: 'Corte Núcleo', offsetDays: 5 },
  { name: 'Ferragem', offsetDays: 7 },
  { name: 'Isolante', offsetDays: 7 },
];

export function isWorkingDayDefault(date: Date) {
  const day = date.getDay();
  // 0 is Sunday, 6 is Saturday
  return day !== 0 && day !== 6;
}

export function isDateValidForProduction(date: Date, config: ValidDaysConfig) {
  const dateStr = format(date, 'yyyy-MM-dd');
  if (config.invalidDays.includes(dateStr)) return false;
  if (config.extraValidDays.includes(dateStr)) return true;
  return isWorkingDayDefault(date);
}

export function subtractValidDays(startDate: Date, daysToSubtract: number, config: ValidDaysConfig): Date {
  let currentDate = startDate;
  let remainingDays = daysToSubtract;

  // Montagem Final date might not be a valid day itself. The prompt says:
  // "A data de Montagem Final também deve respeitar os dias válidos quando usada como base."
  // Wait, if MF itself is 0 offset, does it shift? We should probably snap it to a valid day if it's not.
  // Actually, usually offset 0 just lands on the date. But let's first step back if needed.
  
  while (remainingDays > 0) {
    currentDate = subDays(currentDate, 1);
    if (isDateValidForProduction(currentDate, config)) {
      remainingDays--;
    }
  }

  // If after subtracting (or if 0 subtraction), the date is perfectly fine, great.
  // But if the target happens to land on an invalid day (only happens if daysToSubtract was 0 and startDate is invalid), we step backward until it's valid.
  while (!isDateValidForProduction(currentDate, config)) {
    currentDate = subDays(currentDate, 1);
  }

  return currentDate;
}

export function generateStepsForOP(rawOP: RawOP, config: ValidDaysConfig): OPStep[] {
  const mfDate = parseISO(rawOP.data_mf);
  return PRODUCTION_STEPS.map((stepConfig) => {
    const calcDate = subtractValidDays(mfDate, stepConfig.offsetDays, config);
    const dateStr = format(calcDate, 'yyyy-MM-dd');
    
    return {
      id: `${rawOP.op}_${dateStr}_${stepConfig.name}`,
      op: rawOP.op,
      linha: rawOP.linha,
      qtd_mf: rawOP.qtd_mf,
      data_mf: rawOP.data_mf,
      stepName: stepConfig.name,
      calculatedDate: dateStr,
      usedDate: dateStr,
    };
  });
}

// Ensure Excel dates correctly parsed even if numeric or different string format
export function parseExcelDate(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;

  // XLSX with cellDates:true returns real Date objects for date cells.
  if (value instanceof Date) {
    if (!isValid(value)) return null;
    return format(value, 'yyyy-MM-dd');
  }

  if (typeof value === 'number') {
    // Excel date (1 = 1900-01-01)
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
    return format(dt, 'yyyy-MM-dd');
  }

  if (typeof value === 'string') {
    const cleanValue = value.trim();
    if (!cleanValue) return null;

    const dateOnly = cleanValue.split(' ')[0];

    // formatos mais comuns vindos do Excel/Sankhya
    const formats = ['dd/MM/yyyy', 'dd/MM/yy', 'yyyy-MM-dd', 'MM/dd/yy', 'MM/dd/yyyy'];

    for (const fmt of formats) {
      const parsed = parse(dateOnly, fmt, new Date());
      if (isValid(parsed)) return format(parsed, 'yyyy-MM-dd');
    }

    // ISO attempt
    const parsed = new Date(cleanValue);
    if (isValid(parsed)) return format(parsed, 'yyyy-MM-dd');
  }

  return null;
}
