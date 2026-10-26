'use client';

// T-160 (fase4-pipeline-telas, US-106, AC-390): filtros do funil — busca de
// texto, responsável e origem. Mesmo molde de `FiltrosLista`
// (`filtros-lista.tsx`, T-161), sem etapa (o Kanban já segmenta por etapa,
// AC-387) nem ordenação (não pedida pela AC-390). "Período" e "Visões
// salvas" do protótipo (`6._pipeline_funil_pipeline/code.html`) não têm
// critério de aceite nem API — ficam "em breve" (regra geral herdada da
// feature anterior: o que não tem backend entra visível e marcado).
import { ItemEmBreve } from './pecas/selo-em-breve';

export interface ValorFiltrosFunil {
  busca: string;
  responsavelId?: string;
  origem?: string;
}

export interface OpcaoResponsavelFunil {
  id: string;
  nome: string;
}

interface FiltrosFunilProps {
  valor: ValorFiltrosFunil;
  responsaveis: OpcaoResponsavelFunil[];
  origens: string[];
  onMudar: (patch: Partial<ValorFiltrosFunil>) => void;
  onLimpar: () => void;
}

const CLASSE_CAMPO =
  'h-10 px-3 rounded-xl bg-surface-card text-text-primary font-body-md text-body-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20';

export function FiltrosFunil({ valor, responsaveis, origens, onMudar, onLimpar }: FiltrosFunilProps) {
  return (
    <div className="flex flex-wrap items-center gap-space-sm">
      <input
        type="text"
        value={valor.busca}
        onChange={(evento) => onMudar({ busca: evento.target.value })}
        placeholder="Buscar por nome, e-mail ou telefone..."
        aria-label="Buscar no funil"
        className={`${CLASSE_CAMPO} w-64`}
      />
      <select
        aria-label="Responsável"
        value={valor.responsavelId ?? ''}
        onChange={(evento) => onMudar({ responsavelId: evento.target.value || undefined })}
        className={CLASSE_CAMPO}
      >
        <option value="">Todos os responsáveis</option>
        {responsaveis.map((responsavel) => (
          <option key={responsavel.id} value={responsavel.id}>
            {responsavel.nome}
          </option>
        ))}
      </select>
      <select
        aria-label="Origem"
        value={valor.origem ?? ''}
        onChange={(evento) => onMudar({ origem: evento.target.value || undefined })}
        className={CLASSE_CAMPO}
      >
        <option value="">Origem: Todas</option>
        {origens.map((origem) => (
          <option key={origem} value={origem}>
            {origem}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onLimpar}
        className="h-10 px-3 rounded-xl bg-surface-card hover:bg-surface-subtle text-text-secondary hover:text-text-primary font-label-md text-label-md font-semibold shadow-sm transition-colors"
      >
        Limpar
      </button>
      <ItemEmBreve
        rotulo="Período"
        icone="calendar_today"
        className="h-10 px-3 rounded-xl bg-surface-card shadow-sm"
      />
    </div>
  );
}
