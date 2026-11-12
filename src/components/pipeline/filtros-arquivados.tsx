'use client';

// T-167 (fase4-pipeline-telas, US-108, AC-418): barra de filtros dos
// arquivados — fonte visual `8._pipeline_arquivados_cards_arquivados/code.html`
// (busca, motivo de perda, consultor, data e "Limpar"). A filtragem em si é do
// servidor (`GET /api/oportunidades/arquivados`, AC-402); aqui só se monta o
// valor do filtro.
// fase6-periodo-personalizado (AC-823): o "Fechados desde" (uma data só) virou o período
// completo (De/Até + qual data), o mesmo controle do funil e da lista.
import type { PeriodoEscolhido } from '../analises/comum';
import type { CampoDataPeriodo } from '../../domain/pipeline/periodo';
import { FiltroPeriodoPipeline } from './filtro-periodo-pipeline';

export interface ValorFiltrosArquivados {
  busca: string;
  motivoPerdaId?: string;
  responsavelId?: string;
  /** AC-823: sem período, a tela mostra todos os arquivados. */
  periodo?: PeriodoEscolhido;
  /** AC-823: a data que o período filtra; "última movimentação" aqui é a data de fechamento. */
  campoData?: CampoDataPeriodo;
}

export interface OpcaoFiltroArquivados {
  id: string;
  nome: string;
}

interface FiltrosArquivadosProps {
  valor: ValorFiltrosArquivados;
  motivos: OpcaoFiltroArquivados[];
  responsaveis: OpcaoFiltroArquivados[];
  onMudar: (parcial: Partial<ValorFiltrosArquivados>) => void;
  onLimpar: () => void;
}

const CLASSE_CAMPO =
  'h-10 px-3 rounded-lg bg-surface-subtle text-text-primary font-body-md text-body-md focus:bg-surface-card focus:outline-none focus:ring-2 focus:ring-primary/20';
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

export function filtroArquivadosAtivo(valor: ValorFiltrosArquivados): boolean {
  return Boolean(valor.busca || valor.motivoPerdaId || valor.responsavelId || valor.periodo);
}

export function FiltrosArquivados({ valor, motivos, responsaveis, onMudar, onLimpar }: FiltrosArquivadosProps) {
  return (
    <div className="flex flex-wrap items-center gap-space-sm">
      <div className="relative">
        <span
          aria-hidden="true"
          className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[18px]"
        >
          search
        </span>
        <input
          type="text"
          value={valor.busca}
          onChange={(evento) => onMudar({ busca: evento.target.value })}
          placeholder="Buscar clínica, médico ou CNPJ..."
          aria-label="Buscar nos arquivados"
          className={`${CLASSE_CAMPO} w-72 pl-9`}
        />
      </div>

      <div className="relative">
        <select
          aria-label="Motivo de perda"
          value={valor.motivoPerdaId ?? ''}
          onChange={(evento) => onMudar({ motivoPerdaId: evento.target.value || undefined })}
          className={CLASSE_SELETOR}
        >
          <option value="">Todos os Motivos de Perda</option>
          {motivos.map((motivo) => (
            <option key={motivo.id} value={motivo.id}>
              {motivo.nome}
            </option>
          ))}
        </select>
        <SetaSeletor />
      </div>

      <div className="relative">
        <select
          aria-label="Consultor"
          value={valor.responsavelId ?? ''}
          onChange={(evento) => onMudar({ responsavelId: evento.target.value || undefined })}
          className={CLASSE_SELETOR}
        >
          <option value="">Todos os Consultores</option>
          {responsaveis.map((responsavel) => (
            <option key={responsavel.id} value={responsavel.id}>
              {responsavel.nome}
            </option>
          ))}
        </select>
        <SetaSeletor />
      </div>

      <FiltroPeriodoPipeline
        valor={{ periodo: valor.periodo, data: valor.campoData ?? 'entrada' }}
        onMudar={(proximo) => onMudar({ periodo: proximo.periodo, campoData: proximo.data })}
      />

      <button
        type="button"
        onClick={onLimpar}
        className="h-10 px-3 rounded-lg text-text-secondary hover:text-danger-text hover:bg-danger-surface font-label-md text-label-md font-semibold transition-colors flex items-center gap-1"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
          filter_alt_off
        </span>
        Limpar
      </button>
    </div>
  );
}
