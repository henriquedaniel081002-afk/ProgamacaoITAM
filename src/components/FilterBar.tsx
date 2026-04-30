import React from 'react';
import { Search } from 'lucide-react';

interface Filters {
  dateStart: string;
  dateEnd: string;
  sector: string;
  linha: string;
  op: string;
}

interface FilterBarProps {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  sectors: string[];
}

export function FilterBar({ filters, setFilters, sectors }: FilterBarProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const clearFilters = () => {
    setFilters({ dateStart: '', dateEnd: '', sector: '', linha: '', op: '' });
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-widest text-brand-muted">
        <span>Filtros</span>
        <button onClick={clearFilters} className="hover:text-brand-accent transition-colors" title="Limpar filtros">
          Limpar
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <label className="text-[11px] text-brand-muted">Data Programada</label>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-brand-muted uppercase tracking-wide">De</span>
          <input type="date" name="dateStart" value={filters.dateStart} onChange={handleChange} className="w-full bg-[#1A1A1D] border border-brand-border rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-accent transition-colors" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-brand-muted uppercase tracking-wide">Até</span>
          <input type="date" name="dateEnd" value={filters.dateEnd} onChange={handleChange} className="w-full bg-[#1A1A1D] border border-brand-border rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-accent transition-colors" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-brand-muted">Setor / Etapa</label>
        <select name="sector" value={filters.sector} onChange={handleChange} className="w-full bg-[#1A1A1D] border border-brand-border rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-accent transition-colors appearance-none">
          <option value="">Todos</option>
          {sectors.map(s => (<option key={s} value={s}>{s}</option>))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-brand-muted">Linha</label>
        <select name="linha" value={filters.linha} onChange={handleChange} className="w-full bg-[#1A1A1D] border border-brand-border rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-accent transition-colors appearance-none">
          <option value="">Todas</option>
          <option value="MON">MON</option>
          <option value="TRI">TRI</option>
          <option value="EPO">EPO</option>
          <option value="POT">POT</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-brand-muted">Buscar OP</label>
        <div className="relative">
          <input type="text" name="op" value={filters.op} onChange={handleChange} placeholder="Ex: 12345" className="w-full bg-[#1A1A1D] border border-brand-border rounded-md pl-8 pr-3 py-2 text-xs text-white focus:outline-none focus:border-brand-accent transition-colors" />
          <Search className="w-3.5 h-3.5 text-brand-muted absolute left-2.5 top-2.5" />
        </div>
      </div>
    </div>
  );
}
