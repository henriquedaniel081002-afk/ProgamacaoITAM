import React from 'react';
import { OPStep } from '../lib/productionLogic';
import { Copy, Plus, X, Edit2, Check } from 'lucide-react';
import { formatToBRLDate } from '../lib/utils';

interface DetailSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  groupTitle: string; // e.g. "Bobinagem BT - 24/04/2026"
  steps: OPStep[];
  onManualDateChange: (id: string, newDateStr: string) => void;
}

export function DetailSidebar({ isOpen, onClose, groupTitle, steps, onManualDateChange }: DetailSidebarProps) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState('');

  const copyOP = (op: string) => {
    navigator.clipboard.writeText(op);
  };

  const copyAllOPs = () => {
    const text = steps.map(s => s.op).join('\n');
    navigator.clipboard.writeText(text);
  };

  const startEdit = (step: OPStep) => {
    setEditingId(step.id);
    setEditValue(step.usedDate);
  };

  const saveEdit = (id: string) => {
    if (editValue) {
      onManualDateChange(id, editValue);
    }
    setEditingId(null);
  };

  if (!isOpen) return null;

  return (
    <aside className="fixed inset-y-0 right-0 z-40 bg-brand-bg w-full md:w-[320px] md:static border-l border-brand-border flex flex-col p-5 gap-4 overflow-y-auto shrink-0 transition-transform">
      <div className="flex justify-between items-center bg-brand-bg md:bg-transparent -mx-5 px-5 py-3 md:m-0 md:p-0 sticky top-0 md:static z-10 border-b border-brand-border md:border-none">
        <span className="text-[11px] font-bold uppercase tracking-widest text-brand-muted">
          Detalhes do Grupo
        </span>
        <button onClick={onClose} className="md:hidden text-brand-muted hover:text-white p-2">
          <X className="w-5 h-5" />
        </button>
      </div>
      
      <div className="text-[13px] font-semibold text-white -mt-2">
        {groupTitle}
      </div>

      <button
        onClick={copyAllOPs}
        className="w-full flex justify-center items-center gap-2 py-1.5 px-3 rounded text-[11px] font-bold text-black bg-white hover:bg-brand-accent transition-colors"
      >
        <Copy className="w-3.5 h-3.5" />
        COPIAR TODAS AS OPs
      </button>

      <div className="flex flex-col gap-2 overflow-y-auto pr-1">
        {steps.map((step) => (
          <div key={step.id} className="bg-brand-card border border-brand-border p-3 rounded-lg relative flex flex-col group">
            <div className="font-mono font-bold text-brand-accent mb-1 flex items-center justify-between pr-6">
              #{step.op}
              
              <button
                onClick={() => copyOP(step.op)}
                className="absolute top-3 right-3 text-brand-muted opacity-50 group-hover:opacity-100 hover:!text-brand-accent transition-all pl-2"
                title="Copiar OP"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            
            <div className="text-[10px] text-brand-muted font-mono flex justify-between tracking-wide uppercase">
              <span className="bg-[#1A1A1D] px-1.5 py-0.5 rounded border border-brand-border">{step.linha}</span>
              <span className="bg-[#1A1A1D] px-1.5 py-0.5 rounded border border-brand-border">QTD: {step.qtd_mf}</span>
              <span className="bg-[#1A1A1D] px-1.5 py-0.5 rounded border border-brand-border">MF: {formatToBRLDate(step.data_mf).slice(0, 5)}</span>
            </div>

            {/* Manual Date Adjustment */}
            <div className="pt-2.5 mt-2.5 border-t border-brand-border/50 flex flex-col gap-1.5">
               <span className="text-[10px] text-brand-muted font-bold tracking-wider uppercase">DATA PROGRAMADA</span>
               
               {editingId === step.id ? (
                  <div className="flex items-center gap-1.5">
                    <input 
                      type="date"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="bg-[#1A1A1D] border border-brand-border text-xs rounded px-2 py-1 focus:outline-none focus:border-brand-accent text-white w-full"
                    />
                    <button 
                      onClick={() => saveEdit(step.id)}
                      className="p-1 bg-[#1A1A1D] hover:bg-green-500/20 text-brand-muted hover:text-green-500 rounded transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => setEditingId(null)}
                      className="p-1 bg-[#1A1A1D] hover:bg-red-500/20 text-brand-muted hover:text-red-500 rounded transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
               ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-white">
                      <span>{formatToBRLDate(step.usedDate)}</span>
                      {step.manualDate && (
                        <span className="text-[9px] uppercase font-bold text-brand-accent bg-brand-accent/10 px-1 py-0.5 rounded border border-brand-accent/20">
                          Ajustado
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => startEdit(step)}
                      className="text-[10px] font-semibold flex items-center gap-1 text-brand-muted hover:text-brand-accent transition-colors"
                    >
                      <Edit2 className="w-3 h-3" />
                      EDITAR
                    </button>
                  </div>
               )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
