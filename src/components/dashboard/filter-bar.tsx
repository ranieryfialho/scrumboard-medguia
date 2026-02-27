import { useState } from "react";
import { Search, Stethoscope, CalendarDays, FilterX, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface FilterBarProps {
  buscaNome: string;
  setBuscaNome: (v: string) => void;
  filtroEspecialidade: string;
  setFiltroEspecialidade: (v: string) => void;
  filtroMes: string;
  setFiltroMes: (v: string) => void;
  especialidadesUnicas: string[];
  mesesUnicos: string[];
  limparFiltros: () => void;
  temFiltroAtivo: boolean;
  onAddLead?: (lead: any) => void;
}

// Opções de origem para leads manuais
const ORIGENS_MANUAL = [
  { value: 'Manual',            label: 'Manual (sem origem específica)' },
  { value: 'Manual - LP',       label: 'Landing Page (LP)' },
  { value: 'Manual - Indicação',label: 'Indicação' },
  { value: 'Manual - Outro',    label: 'Outro' },
];

export function FilterBar({
  buscaNome, setBuscaNome,
  filtroEspecialidade, setFiltroEspecialidade,
  filtroMes, setFiltroMes,
  especialidadesUnicas, mesesUnicos,
  limparFiltros, temFiltroAtivo,
  onAddLead
}: FilterBarProps) {

  const [modalNovoLeadOpen, setModalNovoLeadOpen] = useState(false);
  const [novoLead, setNovoLead] = useState({
    nome: '',
    email: '',
    cargo: '',
    whatsapp: '',
    origem: 'Manual',
  });

  const handleSalvarNovoLead = () => {
    if (!novoLead.nome) return;
    if (onAddLead) onAddLead(novoLead);
    setNovoLead({ nome: '', email: '', cargo: '', whatsapp: '', origem: 'Manual' });
    setModalNovoLeadOpen(false);
  };

  return (
    <div className="bg-white border-b border-slate-200 px-8 py-3 w-full shrink-0 z-40 shadow-sm">
      <div className="max-w-[1600px] mx-auto flex flex-wrap items-center gap-4">

        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-slate-400" />
          </div>
          <input
            type="text"
            placeholder="Buscar pelo nome..."
            value={buscaNome}
            onChange={(e) => setBuscaNome(e.target.value)}
            className="block w-full pl-9 pr-3 py-2 border border-slate-200 rounded-md bg-slate-50 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          />
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Stethoscope className="h-4 w-4 text-slate-400" />
          </div>
          <select
            value={filtroEspecialidade}
            onChange={(e) => setFiltroEspecialidade(e.target.value)}
            className="block w-full pl-9 pr-8 py-2 border border-slate-200 rounded-md bg-slate-50 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          >
            <option value="">Todas as especialidades</option>
            {especialidadesUnicas.map(espec => (
              <option key={espec} value={espec}>{espec}</option>
            ))}
          </select>
        </div>

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <CalendarDays className="h-4 w-4 text-slate-400" />
          </div>
          <select
            value={filtroMes}
            onChange={(e) => setFiltroMes(e.target.value)}
            className="block w-full pl-9 pr-8 py-2 border border-slate-200 rounded-md bg-slate-50 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          >
            <option value="">Todos os meses</option>
            {mesesUnicos.map(mes => (
              <option key={mes} value={mes}>{mes}</option>
            ))}
          </select>
        </div>

        {temFiltroAtivo && (
          <Button variant="ghost" onClick={limparFiltros} className="text-slate-500 hover:text-rose-600 h-9 px-3">
            <FilterX className="w-4 h-4 mr-2" />
            Limpar
          </Button>
        )}

        <div className="ml-auto">
          <Dialog open={modalNovoLeadOpen} onOpenChange={setModalNovoLeadOpen}>
            <DialogTrigger asChild>
              <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center gap-2 whitespace-nowrap h-10 px-4">
                <Plus className="w-4 h-4" />
                Adicionar Lead Manual
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[440px]">
              <DialogHeader>
                <DialogTitle>Novo Lead Manual</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nome Completo *</label>
                  <input
                    className="w-full p-2.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 bg-slate-50 text-slate-800"
                    placeholder="Ex: Dr. João Silva"
                    value={novoLead.nome}
                    onChange={e => setNovoLead({ ...novoLead, nome: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">E-mail</label>
                  <input
                    type="email"
                    className="w-full p-2.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 bg-slate-50 text-slate-800"
                    placeholder="Ex: joao@email.com"
                    value={novoLead.email}
                    onChange={e => setNovoLead({ ...novoLead, email: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Especialidade</label>
                  <input
                    className="w-full p-2.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 bg-slate-50 text-slate-800"
                    placeholder="Ex: Cardiologia"
                    value={novoLead.cargo}
                    onChange={e => setNovoLead({ ...novoLead, cargo: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">WhatsApp / Telefone</label>
                  <input
                    className="w-full p-2.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 bg-slate-50 text-slate-800"
                    placeholder="Ex: (11) 99999-9999"
                    value={novoLead.whatsapp}
                    onChange={e => setNovoLead({ ...novoLead, whatsapp: e.target.value })}
                  />
                </div>

                {/* NOVO: Origem do lead manual */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Origem *</label>
                  <select
                    className="w-full p-2.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 bg-slate-50 text-slate-800"
                    value={novoLead.origem}
                    onChange={e => setNovoLead({ ...novoLead, origem: e.target.value })}
                  >
                    {ORIGENS_MANUAL.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-400">
                    Como este lead chegou até você?
                  </p>
                </div>

              </div>
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setModalNovoLeadOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSalvarNovoLead}
                  disabled={!novoLead.nome}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-md transition-colors"
                >
                  Salvar Lead
                </button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

      </div>
    </div>
  );
}