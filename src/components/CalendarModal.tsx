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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-bg/80 backdrop-blur-sm">
      <div className="bg-brand-card border border-brand-border rounded-xl w-full max-w-md shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-brand-border">
          <div className="flex items-center gap-2 text-white">
            <h2 className="font-bold text-sm uppercase tracking-wider text-brand-muted">Dias Válidos</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-brand-muted hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-2 rounded-lg bg-[#1A1A1D] text-brand-muted hover:text-white transition">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="text-white font-semibold capitalize text-[13px] uppercase tracking-widest">
              {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
            </h3>
            <button onClick={nextMonth} className="p-2 rounded-lg bg-[#1A1A1D] text-brand-muted hover:text-white transition">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
              <div key={d} className="text-center text-[10px] font-bold text-brand-muted uppercase tracking-wider py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: monthStart.getDay() }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square" />
            ))}
            
            {daysInMonth.map((day) => {
              const isValidDay = isDateValidForProduction(day, localConfig);
              const today = isToday(day);
              
              return (
                <button
                  key={day.toString()}
                  onClick={() => toggleDay(day)}
                  className={cn(
                    "aspect-square flex items-center justify-center rounded text-[11px] font-mono transition-all duration-200 border",
                    isValidDay 
                      ? "bg-brand-accent/20 border-brand-accent text-brand-accent hover:opacity-80"
                      : "bg-transparent border-brand-border text-brand-muted opacity-30 hover:opacity-80",
                    today && isValidDay && "ring-1 ring-brand-accent ring-offset-1 ring-offset-brand-bg"
                  )}
                >
                  {format(day, 'dd')}
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                onClick={markAllWorkingDaysInMonth}
                className="flex-1 text-[11px] py-2 px-3 bg-[#1A1A1D] border border-brand-border hover:bg-brand-border text-white rounded font-semibold uppercase tracking-wider transition"
              >
                Marcar úteis
              </button>
              <button
                onClick={clearSelectionInMonth}
                className="flex-1 text-[11px] py-2 px-3 bg-[#1A1A1D] border border-brand-border hover:bg-brand-border text-white rounded font-semibold uppercase tracking-wider transition"
              >
                Limpar
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-brand-border flex justify-end gap-3 rounded-b-xl bg-[#1A1A1D]/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-[11px] font-bold text-brand-muted hover:text-white transition tracking-widest uppercase"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              onSave(localConfig);
              onClose();
            }}
            className="px-4 py-2 rounded text-[11px] font-bold bg-brand-accent text-black hover:opacity-90 transition tracking-widest uppercase"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
