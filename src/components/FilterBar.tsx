import React from 'react';
import { ChevronDown } from 'lucide-react';

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
    <div className="flex w-full flex-col gap-5">
      <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.2em] text-brand-muted">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-accent" />
          Filtros
        </span>
        <button type="button" onClick={clearFilters} className="link-button rounded-md px-2 py-1 transition-colors hover:text-brand-accent" title="Limpar filtros">
          Limpar
        </button>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-brand-border/80 bg-brand-panel/60 p-3.5">
        <legend className="px-1 text-[11px] font-semibold text-brand-soft">Data Programada</legend>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-date-start" className="text-[10px] uppercase tracking-[0.16em] text-brand-muted">De</label>
          <input id="filter-date-start" type="date" name="dateStart" value={filters.dateStart} onChange={handleChange} className="ui-field" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-date-end" className="text-[10px] uppercase tracking-[0.16em] text-brand-muted">Até</label>
          <input id="filter-date-end" type="date" name="dateEnd" value={filters.dateEnd} onChange={handleChange} className="ui-field" />
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-sector" className="text-[11px] font-semibold text-brand-soft">Setor / Etapa</label>
        <div className="relative">
          <select id="filter-sector" name="sector" value={filters.sector} onChange={handleChange} className="ui-field appearance-none pr-9">
            <option value="">Todos</option>
            {sectors.map(s => (<option key={s} value={s}>{s}</option>))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-brand-muted" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-linha" className="text-[11px] font-semibold text-brand-soft">Linha</label>
        <div className="relative">
          <select id="filter-linha" name="linha" value={filters.linha} onChange={handleChange} className="ui-field appearance-none pr-9">
            <option value="">Todas</option>
            <option value="MON">MON</option>
            <option value="TRI">TRI</option>
            <option value="EPO">EPO</option>
            <option value="POT">POT</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-brand-muted" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-op" className="text-[11px] font-semibold text-brand-soft">Buscar OP</label>
        <input
          id="filter-op"
          type="text"
          name="op"
          value={filters.op}
          onChange={handleChange}
          placeholder="Digite a OP"
          className="ui-field filter-op-field"
          autoComplete="off"
        />
      </div>
    </div>
  );
}
