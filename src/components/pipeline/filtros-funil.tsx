'use client';

// T-160 (fase4-pipeline-telas, US-106, AC-390): filtros do funil — busca de
// texto, responsável e origem. Mesmo molde de `FiltrosLista`
// (`filtros-lista.tsx`, T-161), sem etapa (o Kanban já segmenta por etapa,
// AC-387) nem ordenação (não pedida pela AC-390). "Visões salvas" do protótipo
// (`6._pipeline_funil_pipeline/code.html`) não tem critério de aceite nem API (regra
// geral herdada da feature anterior: o que não tem backend entra visível e marcado).
// fase6-periodo-personalizado (AC-820): o "Período" deixou de ser "em breve" e filtra
// de verdade, pela entrada do lead ou pela última movimentação.
import type { PeriodoEscolhido } from '../analises/comum';
import type { CampoDataPeriodo } from '../../domain/pipeline/periodo';
import { FiltroPeriodoPipeline } from './filtro-periodo-pipeline';

export interface ValorFiltrosFunil {
  busca: string;
  responsavelId?: string;
  origem?: string;
  /** AC-820: sem período, o quadro mostra todos os cards. */
  periodo?: PeriodoEscolhido;
  /** AC-820: a data que o período filtra (padrão: a entrada do lead). */
  campoData?: CampoDataPeriodo;
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

// Seletor do protótipo: sem a seta nativa do navegador (`appearance-none`) e com a seta própria à direita.
const CLASSE_SELETOR = `${CLASSE_CAMPO} pr-8 appearance-none cursor-pointer`;

function SetaSeletor() {
  return (
    <span
      aria-hidden="true"
      className="material-symbols-outlined pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[18px]"
    >
      expand_more
    </span>
  );
}

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
      <div className="relative">
      <select
        aria-label="Responsável"
        value={valor.responsavelId ?? ''}
        onChange={(evento) => onMudar({ responsavelId: evento.target.value || undefined })}
        className={CLASSE_SELETOR}
      >
        <option value="">Todos os responsáveis</option>
        {responsaveis.map((responsavel) => (
          <option key={responsavel.id} value={responsavel.id}>
            {responsavel.nome}
          </option>
        ))}
      </select>
      <SetaSeletor />
      </div>
      <div className="relative">
      <select
        aria-label="Origem"
        value={valor.origem ?? ''}
        onChange={(evento) => onMudar({ origem: evento.target.value || undefined })}
        className={CLASSE_SELETOR}
      >
        <option value="">Origem: Todas</option>
        {origens.map((origem) => (
          <option key={origem} value={origem}>
            {origem}
          </option>
        ))}
      </select>
      <SetaSeletor />
      </div>
      <button
        type="button"
        onClick={onLimpar}
        className="h-10 px-3 rounded-xl bg-surface-card hover:bg-surface-subtle text-text-secondary hover:text-text-primary font-label-md text-label-md font-semibold shadow-sm transition-colors"
      >
        Limpar
      </button>
      <FiltroPeriodoPipeline
        valor={{ periodo: valor.periodo, data: valor.campoData ?? 'entrada' }}
        onMudar={(proximo) => onMudar({ periodo: proximo.periodo, campoData: proximo.data })}
      />
    </div>
  );
}
