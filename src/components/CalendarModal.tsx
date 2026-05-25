import React, { useState, useEffect } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ValidDaysConfig, isDateValidForProduction, isWorkingDayDefault } from '../lib/productionLogic';
import { cn } from '../lib/utils';

interface CalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ValidDaysConfig;
  onSave: (newConfig: ValidDaysConfig) => void;
}

export function CalendarModal({ isOpen, onClose, config, onSave }: CalendarModalProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [localConfig, setLocalConfig] = useState<ValidDaysConfig>(config);

  useEffect(() => {
    if (isOpen) {
      setLocalConfig(config);
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const toggleDay = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const isDefaultWorking = isWorkingDayDefault(date);
    const isCurrentlyValid = isDateValidForProduction(date, localConfig);

    setLocalConfig((prev) => {
      let newInvalid = [...prev.invalidDays];
      let newExtra = [...prev.extraValidDays];

      if (isCurrentlyValid) {
        if (isDefaultWorking) {
          newInvalid.push(dateStr);
        } else {
          newExtra = newExtra.filter((d) => d !== dateStr);
        }
      } else {
        if (isDefaultWorking) {
          newInvalid = newInvalid.filter((d) => d !== dateStr);
        } else {
          newExtra.push(dateStr);
        }
      }

      return { invalidDays: newInvalid, extraValidDays: newExtra };
    });
  };

  const markAllWorkingDaysInMonth = () => {
    setLocalConfig((prev) => {
      let newInvalid = [...prev.invalidDays];
      const newExtra = [...prev.extraValidDays];
      
      daysInMonth.forEach((day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        if (isWorkingDayDefault(day)) {
          newInvalid = newInvalid.filter((d) => d !== dateStr);
        }
      });
      return { invalidDays: newInvalid, extraValidDays: newExtra };
    });
  };

  const clearSelectionInMonth = () => {
    setLocalConfig((prev) => {
      const newInvalid = [...prev.invalidDays];
      let newExtra = [...prev.extraValidDays];
      
      daysInMonth.forEach((day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        if (!isWorkingDayDefault(day)) {
          newExtra = newExtra.filter((d) => d !== dateStr);
        } else {
          if (!newInvalid.includes(dateStr)) {
            newInvalid.push(dateStr);
          }
        }
      });
      return { invalidDays: newInvalid, extraValidDays: newExtra };
    });
  };

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-bg/85 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="calendar-modal-title" className="panel-shadow flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-brand-border bg-brand-card">
        <div className="flex items-start justify-between border-b border-brand-border px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl border border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
              <CalendarIcon className="h-5 w-5" />
            </span>
            <div>
              <h2 id="calendar-modal-title" className="text-base font-bold text-white">Dias válidos</h2>
              <p className="mt-1 text-xs text-brand-muted">Defina os dias disponíveis para produção.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="ui-icon-button" aria-label="Fechar calendário">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          <div className="mb-5 flex items-center justify-between">
            <button type="button" onClick={prevMonth} className="ui-icon-button" aria-label="Mês anterior">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h3 className="text-sm font-bold capitalize tracking-[0.15em] text-white">
              {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
            </h3>
            <button type="button" onClick={nextMonth} className="ui-icon-button" aria-label="Próximo mês">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-2 grid grid-cols-7 gap-1.5">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
              <div key={d} className="py-1 text-center text-[10px] font-bold uppercase tracking-[0.15em] text-brand-muted">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: monthStart.getDay() }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square" />
            ))}
            
            {daysInMonth.map((day) => {
              const isValidDay = isDateValidForProduction(day, localConfig);
              const today = isToday(day);
              
              return (
                <button
                  type="button"
                  key={day.toString()}
                  onClick={() => toggleDay(day)}
                  aria-pressed={isValidDay}
                  aria-label={`${format(day, 'dd/MM/yyyy')} - ${isValidDay ? 'dia válido' : 'dia bloqueado'}`}
                  className={cn(
                    "day-button aspect-square flex items-center justify-center rounded-lg border text-xs font-mono font-semibold transition-all duration-200",
                    isValidDay 
                      ? "border-brand-accent/45 bg-brand-accent/15 text-brand-accent hover:bg-brand-accent/25"
                      : "border-brand-border bg-brand-panel/40 text-brand-muted/50 hover:border-brand-border hover:text-brand-muted",
                    today && "ring-1 ring-brand-accent ring-offset-2 ring-offset-brand-card"
                  )}
                >
                  {format(day, 'dd')}
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center gap-5 rounded-xl border border-brand-border/70 bg-brand-panel/55 px-3 py-2.5 text-[11px] text-brand-muted">
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded border border-brand-accent/50 bg-brand-accent/20" /> Disponível</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded border border-brand-border bg-brand-panel" /> Bloqueado</span>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={markAllWorkingDaysInMonth}
              className="ui-button ui-button-secondary flex-1 text-[11px] uppercase tracking-[0.13em]"
            >
              Marcar úteis
            </button>
            <button
              type="button"
              onClick={clearSelectionInMonth}
              className="ui-button ui-button-secondary flex-1 text-[11px] uppercase tracking-[0.13em]"
            >
              Limpar
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-brand-border bg-brand-panel/55 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="ui-button border-transparent bg-transparent text-brand-muted hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(localConfig);
              onClose();
            }}
            className="ui-button ui-button-primary px-5"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
