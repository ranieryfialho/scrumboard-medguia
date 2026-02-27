"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Lead } from "@/types/lead";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Settings2, ChevronUp, ChevronDown, ChevronsUpDown,
  Filter, X, Search, CheckSquare, Square,
} from "lucide-react";

interface LeadsTableProps {
  leads: Lead[];
  onStatusChange?: (id: string, novaSituacao: string) => void;
}

const COLUNAS_DISPONIVEIS = [
  { id: "nome",           label: "Nome" },
  { id: "cargo",          label: "Especialidade/Cargo" },
  { id: "whatsapp",       label: "WhatsApp" },
  { id: "email",          label: "E-mail" },
  { id: "situacao",       label: "Situação" },
  { id: "origem",         label: "Origem" },
  { id: "created_time",   label: "Data de Criação" },
  { id: "data_alteracao", label: "Última Alteração" },
];

const COLUNAS_PADRAO = ["nome", "cargo", "whatsapp", "email", "situacao", "origem", "created_time"];

// ── Chaves do localStorage ────────────────────────────────────────────────────
const LS_COLUNAS   = "medguia_tabela_colunas";
const LS_FILTROS   = "medguia_tabela_filtros";
const LS_SORT      = "medguia_tabela_sort";

type SortDir = "asc" | "desc" | null;

// ColFilter serializado para JSON (Set → Array)
interface ColFilterRaw {
  selectedValues: string[];
  invertMode: boolean;
}

interface ColFilter {
  search: string;
  selectedValues: Set<string>;
  invertMode: boolean;
}

// ── Utilitários de localStorage ───────────────────────────────────────────────
function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ── Leitores tipados ──────────────────────────────────────────────────────────
function lerColunas(): string[] {
  const saved = lsGet<string[]>(LS_COLUNAS, COLUNAS_PADRAO);
  if (
    Array.isArray(saved) &&
    saved.length > 0 &&
    saved.every(v => typeof v === "string" && COLUNAS_DISPONIVEIS.some(c => c.id === v))
  ) return saved;
  return COLUNAS_PADRAO;
}

function lerFiltros(): Record<string, ColFilter> {
  const raw = lsGet<Record<string, ColFilterRaw>>(LS_FILTROS, {});
  const result: Record<string, ColFilter> = {};
  for (const [colId, f] of Object.entries(raw)) {
    if (Array.isArray(f.selectedValues)) {
      result[colId] = {
        search: "",
        selectedValues: new Set<string>(f.selectedValues),
        invertMode: !!f.invertMode,
      };
    }
  }
  return result;
}

function lerSort(): { col: string | null; dir: SortDir } {
  return lsGet<{ col: string | null; dir: SortDir }>(LS_SORT, { col: null, dir: null });
}

// Serializa colFilters para JSON (Set → Array, omite vazios)
function serializarFiltros(filters: Record<string, ColFilter>): Record<string, ColFilterRaw> {
  const result: Record<string, ColFilterRaw> = {};
  for (const [colId, f] of Object.entries(filters)) {
    if (f.selectedValues.size > 0) {
      result[colId] = {
        selectedValues: Array.from(f.selectedValues),
        invertMode: f.invertMode,
      };
    }
  }
  return result;
}

// ── Helpers de display ────────────────────────────────────────────────────────
function formatarTelefone(raw: string): string {
  if (!raw) return "";
  const limpo = raw.replace(/^p:?\s*/i, "").trim();
  const nums = limpo.replace(/\D/g, "");
  if (nums.length === 0) return limpo;
  if (nums.startsWith("55") && nums.length >= 12) {
    const ddd  = nums.slice(2, 4);
    const rest = nums.slice(4);
    if (rest.length === 9) return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  if (nums.length === 11) return `(${nums.slice(0, 2)}) ${nums.slice(2, 7)}-${nums.slice(7)}`;
  if (nums.length === 10) return `(${nums.slice(0, 2)}) ${nums.slice(2, 6)}-${nums.slice(6)}`;
  if (nums.length === 9)  return `${nums.slice(0, 5)}-${nums.slice(5)}`;
  if (nums.length === 8)  return `${nums.slice(0, 4)}-${nums.slice(4)}`;
  return limpo;
}

function resolverContatos(lead: Lead) {
  let realEmail = "";
  let realPhone = "";
  const extrair = (valor?: string) => {
    if (!valor) return;
    const limpo = valor.replace(/^p:?\s*/i, "").trim();
    if (limpo.includes("@")) realEmail = limpo;
    else if (/\d{8}/.test(limpo)) realPhone = limpo;
  };
  extrair(lead.email);
  extrair(lead.whatsapp);
  return { realEmail, realPhone };
}

function getCellValue(lead: Lead, colId: string): string {
  if (colId === "email") {
    const { realEmail } = resolverContatos(lead);
    return realEmail || lead.email || "";
  }
  if (colId === "whatsapp") {
    const { realPhone } = resolverContatos(lead);
    return realPhone || lead.whatsapp || "";
  }
  const val = lead[colId];
  return val !== undefined && val !== null && val !== "" ? String(val) : "";
}

function displayValue(colId: string, val: string): string {
  if (!val) return "-";
  if (colId === "whatsapp") return formatarTelefone(val) || "-";
  return val;
}

// ── Componente principal ───────────────────────────────────────────────────────
export function LeadsTable({ leads, onStatusChange }: LeadsTableProps) {

  // ── Estado com inicialização do localStorage ──────────────────────────────
  const [colunasVisiveis, setColunasVisiveis] = useState<string[]>(() => lerColunas());
  const [colFilters, setColFilters]           = useState<Record<string, ColFilter>>(() => lerFiltros());
  const [sortCol, setSortCol]                 = useState<string | null>(() => lerSort().col);
  const [sortDir, setSortDir]                 = useState<SortDir>(() => lerSort().dir);

  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  // ── Persistência automática ───────────────────────────────────────────────
  // Colunas
  const toggleColuna = (id: string) => {
    setColunasVisiveis(prev => {
      const next = prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id];
      lsSet(LS_COLUNAS, next);
      return next;
    });
  };

  const restaurarColunasPadrao = () => {
    setColunasVisiveis(COLUNAS_PADRAO);
    lsSet(LS_COLUNAS, COLUNAS_PADRAO);
  };

  // Ordenação
  const handleSort = (colId: string) => {
    let newCol: string | null = colId;
    let newDir: SortDir = "asc";
    if (sortCol === colId && sortDir === "asc")  { newDir = "desc"; }
    if (sortCol === colId && sortDir === "desc") { newCol = null; newDir = null; }
    setSortCol(newCol);
    setSortDir(newDir);
    lsSet(LS_SORT, { col: newCol, dir: newDir });
  };

  // Filtros — helper interno que persiste após cada mudança
  const atualizarFiltro = (colId: string, patch: Partial<ColFilter>) => {
    setColFilters(prev => {
      const cur = prev[colId] ?? { search: "", selectedValues: new Set<string>(), invertMode: false };
      const next = { ...prev, [colId]: { ...cur, ...patch } };
      lsSet(LS_FILTROS, serializarFiltros(next));
      return next;
    });
  };

  const limparFiltroColuna = (colId: string) => {
    setColFilters(prev => {
      const next = { ...prev };
      delete next[colId];
      lsSet(LS_FILTROS, serializarFiltros(next));
      return next;
    });
  };

  const limparTodosFiltros = () => {
    setColFilters({});
    lsSet(LS_FILTROS, {});
  };

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node))
        setOpenFilterCol(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Derivados ─────────────────────────────────────────────────────────────
  const getFilter = (colId: string): ColFilter =>
    colFilters[colId] ?? { search: "", selectedValues: new Set<string>(), invertMode: false };

  const hasActiveFilter = (colId: string) => {
    const f = colFilters[colId];
    return f && f.selectedValues.size > 0;
  };

  const totalActiveFilters = Object.values(colFilters).filter(f => f.selectedValues.size > 0).length;

  const uniqueValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of COLUNAS_DISPONIVEIS) {
      const vals = Array.from(
        new Set(leads.map(l => getCellValue(l, col.id) || "(vazio)"))
      ).sort((a, b) => a.localeCompare(b, "pt-BR"));
      map[col.id] = vals;
    }
    return map;
  }, [leads]);

  const leadsProcessados = useMemo(() => {
    let result = [...leads];
    for (const [colId, f] of Object.entries(colFilters)) {
      if (f.selectedValues.size === 0) continue;
      result = result.filter(lead => {
        const val = getCellValue(lead, colId) || "(vazio)";
        const match = f.selectedValues.has(val);
        return f.invertMode ? !match : match;
      });
    }
    if (sortCol && sortDir) {
      result.sort((a, b) => {
        const va = getCellValue(a, sortCol).toLowerCase();
        const vb = getCellValue(b, sortCol).toLowerCase();
        const cmp = va.localeCompare(vb, "pt-BR");
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [leads, colFilters, sortCol, sortDir]);

  const colunasAtivas = COLUNAS_DISPONIVEIS.filter(c => colunasVisiveis.includes(c.id));

  // ── Render ─────────────────────────────────────────────────────���──────────
  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

      {/* Barra superior */}
      <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50 shrink-0 gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-700">
            Visualização em Tabela{" "}
            <span className="text-slate-400 font-normal">
              ({leadsProcessados.length}
              {leadsProcessados.length !== leads.length && ` de ${leads.length}`} leads)
            </span>
          </h2>

          {totalActiveFilters > 0 && (
            <button
              onClick={limparTodosFiltros}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 transition-colors"
            >
              <X className="w-3 h-3" />
              Limpar {totalActiveFilters} filtro{totalActiveFilters > 1 ? "s" : ""}
            </button>
          )}
        </div>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 flex items-center gap-2 bg-white hover:bg-slate-50 shrink-0">
              <Settings2 className="w-4 h-4 text-slate-500" />
              Colunas
              <span className="ml-1 text-[11px] font-bold text-indigo-500">
                {colunasVisiveis.length}/{COLUNAS_DISPONIVEIS.length}
              </span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader><DialogTitle>Configurar Colunas</DialogTitle></DialogHeader>
            <div className="py-4 grid grid-cols-2 gap-3">
              {COLUNAS_DISPONIVEIS.map(col => (
                <label key={col.id} className="flex items-center gap-2 cursor-pointer p-2 rounded-md hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                    checked={colunasVisiveis.includes(col.id)}
                    onChange={() => toggleColuna(col.id)}
                  />
                  <span className="text-sm text-slate-700">{col.label}</span>
                </label>
              ))}
            </div>
            <div className="border-t border-slate-100 pt-3 flex justify-end">
              <button
                onClick={restaurarColunasPadrao}
                className="text-xs text-slate-500 hover:text-indigo-600 font-medium transition-colors"
              >
                Restaurar padrão
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tabela */}
      <div className="flex-1 overflow-auto custom-scrollbar" ref={filterRef}>
        <table className="w-full text-sm border-collapse" style={{ minWidth: `${colunasAtivas.length * 170}px` }}>
          <thead className="sticky top-0 z-20 bg-slate-50">
            <tr>
              {colunasAtivas.map(col => {
                const isActive = hasActiveFilter(col.id);
                const isSorted = sortCol === col.id;
                const f = getFilter(col.id);
                return (
                  <th key={col.id} className="text-left border-b border-slate-200 bg-slate-50 select-none" style={{ padding: 0 }}>
                    <div className="flex items-center group">
                      <button
                        onClick={() => handleSort(col.id)}
                        className="flex items-center gap-1.5 px-3 py-3 flex-1 font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors text-left"
                      >
                        <span>{col.label}</span>
                        <span className="text-slate-400">
                          {isSorted && sortDir === "asc"  && <ChevronUp   className="w-3.5 h-3.5 text-indigo-500" />}
                          {isSorted && sortDir === "desc" && <ChevronDown  className="w-3.5 h-3.5 text-indigo-500" />}
                          {!isSorted && <ChevronsUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />}
                        </span>
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setOpenFilterCol(openFilterCol === col.id ? null : col.id);
                        }}
                        className={`px-2 py-3 transition-colors rounded-r ${
                          isActive
                            ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                            : "text-slate-400 hover:text-slate-600 hover:bg-slate-100 opacity-0 group-hover:opacity-100"
                        }`}
                        title="Filtrar coluna"
                      >
                        <Filter className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {openFilterCol === col.id && (
                      <ColumnFilterDropdown
                        colId={col.id}
                        colLabel={col.label}
                        allValues={uniqueValues[col.id] ?? []}
                        filter={f}
                        onFilterChange={patch => atualizarFiltro(col.id, patch)}
                        onClear={() => limparFiltroColuna(col.id)}
                        onClose={() => setOpenFilterCol(null)}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {leadsProcessados.length === 0 ? (
              <tr>
                <td colSpan={colunasAtivas.length} className="h-32 text-center text-slate-400 px-4 py-8">
                  Nenhum lead encontrado para os filtros aplicados.
                </td>
              </tr>
            ) : (
              leadsProcessados.map(lead => (
                <tr key={lead.id} className="hover:bg-slate-50/60 transition-colors border-b border-slate-100 last:border-0">
                  {colunasAtivas.map(col => {
                    const valor = getCellValue(lead, col.id);
                    return (
                      <td key={col.id} className="px-3 py-3 text-slate-600 whitespace-nowrap max-w-[300px] overflow-hidden text-ellipsis">
                        {col.id === "situacao" ? (
                          <SituacaoBadge valor={valor} />
                        ) : col.id === "origem" ? (
                          <OrigemBadge valor={valor} />
                        ) : (
                          <span className={col.id === "nome" ? "font-medium text-slate-900" : ""}>
                            {displayValue(col.id, valor)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Badge de situação ──────────────────────────────────────────────────────────
const SITUACAO_COLORS: Record<string, string> = {
  "Novos Leads":         "bg-blue-50   text-blue-700   border-blue-200",
  "Em contato":          "bg-yellow-50 text-yellow-700 border-yellow-200",
  "Recontato":           "bg-orange-50 text-orange-700 border-orange-200",
  "Reunião agendada":    "bg-purple-50 text-purple-700 border-purple-200",
  "Aguardando Ativação": "bg-cyan-50   text-cyan-700   border-cyan-200",
  "Fechado":             "bg-green-50  text-green-700  border-green-200",
  "Sem interesse":       "bg-slate-100 text-slate-600  border-slate-200",
  "Desqualificado":      "bg-red-50    text-red-700    border-red-200",
  "Arquivado":           "bg-slate-100 text-slate-500  border-slate-200",
};

function SituacaoBadge({ valor }: { valor: string }) {
  const cls = SITUACAO_COLORS[valor] ?? "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border uppercase tracking-wider ${cls}`}>
      {valor || "-"}
    </span>
  );
}

// ── Badge de origem ────────────────────────────────────────────────────────────
const ORIGEM_COLORS: Record<string, string> = {
  "Manual":             "bg-slate-100  text-slate-600  border-slate-200",
  "Manual - LP":        "bg-violet-50  text-violet-700 border-violet-200",
  "Manual - Indicação": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Manual - Outro":     "bg-slate-100  text-slate-600  border-slate-200",
  "BM Dr. Felipe":      "bg-sky-50     text-sky-700    border-sky-200",
  "BM MedGuia":         "bg-indigo-50  text-indigo-700 border-indigo-200",
};

function OrigemBadge({ valor }: { valor: string }) {
  const cls = ORIGEM_COLORS[valor] ?? "bg-slate-100 text-slate-600 border-slate-200";
  return valor ? (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${cls}`}>
      {valor}
    </span>
  ) : <span className="text-slate-400">-</span>;
}

// ── Dropdown de filtro por coluna ──────────────────────────────────────────────
interface DropdownProps {
  colId:          string;
  colLabel:       string;
  allValues:      string[];
  filter:         ColFilter;
  onFilterChange: (patch: Partial<ColFilter>) => void;
  onClear:        () => void;
  onClose:        () => void;
}

function ColumnFilterDropdown({ colLabel, allValues, filter, onFilterChange, onClear, onClose }: DropdownProps) {
  const [localSearch, setLocalSearch] = useState(filter.search);

  const visibleValues = useMemo(
    () => allValues.filter(v => v.toLowerCase().includes(localSearch.toLowerCase())),
    [allValues, localSearch]
  );

  const allVisibleSelected = visibleValues.length > 0 && visibleValues.every(v => filter.selectedValues.has(v));
  const someSelected = filter.selectedValues.size > 0;

  const toggleValue = (val: string) => {
    const next = new Set(filter.selectedValues);
    if (next.has(val)) next.delete(val); else next.add(val);
    onFilterChange({ selectedValues: next });
  };

  const toggleAllVisible = () => {
    const next = new Set(filter.selectedValues);
    if (allVisibleSelected) visibleValues.forEach(v => next.delete(v));
    else visibleValues.forEach(v => next.add(v));
    onFilterChange({ selectedValues: next });
  };

  return (
    <div
      className="absolute z-50 mt-1 w-72 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
          Filtrar: {colLabel}
        </span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Modo mostrar / ocultar */}
      <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
        <span className="text-xs text-slate-500 font-medium">Modo:</span>
        <button
          onClick={() => onFilterChange({ invertMode: false })}
          className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${!filter.invertMode ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
        >
          Mostrar selecionados
        </button>
        <button
          onClick={() => onFilterChange({ invertMode: true })}
          className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${filter.invertMode ? "bg-red-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
        >
          Ocultar selecionados
        </button>
      </div>

      {/* Busca */}
      <div className="px-3 py-2 border-b border-slate-100">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar valor..."
            value={localSearch}
            onChange={e => setLocalSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-slate-50"
            autoFocus
          />
        </div>
      </div>

      {/* Selecionar todos */}
      <div className="px-3 py-1.5 border-b border-slate-100">
        <button
          onClick={toggleAllVisible}
          className="flex items-center gap-2 text-xs text-indigo-600 font-semibold hover:text-indigo-800 transition-colors"
        >
          {allVisibleSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
          {allVisibleSelected ? "Desmarcar todos" : "Selecionar todos"}
          {visibleValues.length !== allValues.length && ` (${visibleValues.length} visíveis)`}
        </button>
      </div>

      {/* Lista de valores */}
      <div className="max-h-52 overflow-y-auto">
        {visibleValues.length === 0 ? (
          <p className="text-center text-xs text-slate-400 py-4">Nenhum valor encontrado</p>
        ) : (
          visibleValues.map(val => (
            <label key={val} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={filter.selectedValues.has(val)}
                onChange={() => toggleValue(val)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
              />
              <span className="text-xs text-slate-700 truncate">{val}</span>
            </label>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-between bg-slate-50">
        <span className="text-[11px] text-slate-400">
          {filter.selectedValues.size > 0
            ? `${filter.selectedValues.size} selecionado${filter.selectedValues.size > 1 ? "s" : ""}`
            : "Nenhum selecionado"}
        </span>
        <div className="flex gap-2">
          {someSelected && (
            <button
              onClick={onClear}
              className="text-xs text-slate-500 hover:text-red-500 font-medium transition-colors"
            >
              Limpar
            </button>
          )}
          <button
            onClick={onClose}
            className="text-xs px-3 py-1 bg-indigo-600 text-white rounded-md font-semibold hover:bg-indigo-700 transition-colors"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}