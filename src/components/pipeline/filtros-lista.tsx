'use client';

// T-161 (fase4-pipeline-telas, US-107, AC-396): filtros da tela de lista —
// etapa, responsável, origem, busca de texto e ordenação. Só mostra os
// controles e avisa a tela (`src/app/(app)/pipeline/lista/page.tsx`) do que
// mudou; quem busca a página filtrada no servidor é a tela (o filtro e a
// ordenação em si já são do servidor — T-154/T-155, AC-396). ASM-132: nomes
// de etapa do banco; só as 1 a 13 (14/15 são os arquivados, fora daqui —
// AC-398). ASM-137: a origem oferece os valores que já existem na empresa
// (decisão do usuário, 26/10 — sem lista oficial), vindos da tela.
export const ETAPAS_LISTA: { id: number; nome: string }[] = [
  { id: 1, nome: 'Entrada de leads' },
  { id: 2, nome: '1º dia de contato' },
  { id: 3, nome: '2º dia de contato' },
  { id: 4, nome: '3º dia de contato' },
  { id: 5, nome: 'Qualificando' },
  { id: 6, nome: 'Qualificado p/ reunião' },
  { id: 7, nome: 'Follow de longo prazo' },
  { id: 8, nome: 'Reunião agendada' },
  { id: 9, nome: 'No-show' },
  { id: 10, nome: 'Reunião realizada' },
  { id: 11, nome: 'Proposta' },
  { id: 12, nome: 'Teste (Trial)' },
  { id: 13, nome: 'Negociação' },
];

export function nomeDaEtapaLista(etapaId: number): string {
  return ETAPAS_LISTA.find((etapa) => etapa.id === etapaId)?.nome ?? `Etapa ${etapaId}`;
}

export type OrdenacaoLista = 'valor' | 'proximaAcao' | 'criadoEm';
export type DirecaoOrdenacao = 'asc' | 'desc';

export interface ValorFiltrosLista {
  busca: string;
  etapaId?: number;
  responsavelId?: string;
  origem?: string;
  ordenarPor?: OrdenacaoLista;
  ordem?: DirecaoOrdenacao;
}

export interface OpcaoResponsavel {
  id: string;
  nome: string;
}

interface FiltrosListaProps {
  valor: ValorFiltrosLista;
  responsaveis: OpcaoResponsavel[];
  origens: string[];
  onMudar: (patch: Partial<ValorFiltrosLista>) => void;
  onLimpar: () => void;
}

interface OpcaoOrdenacao {
  chave: string;
  rotulo: string;
  ordenarPor: OrdenacaoLista;
  ordem: DirecaoOrdenacao;
}

const OPCOES_ORDENACAO: OpcaoOrdenacao[] = [
  { chave: 'valor-desc', rotulo: 'Valor (maior primeiro)', ordenarPor: 'valor', ordem: 'desc' },
  { chave: 'valor-asc', rotulo: 'Valor (menor primeiro)', ordenarPor: 'valor', ordem: 'asc' },
  { chave: 'proximaAcao-asc', rotulo: 'Próxima ação (mais próxima)', ordenarPor: 'proximaAcao', ordem: 'asc' },
  { chave: 'proximaAcao-desc', rotulo: 'Próxima ação (mais distante)', ordenarPor: 'proximaAcao', ordem: 'desc' },
];

function chaveDaOrdenacao(ordenarPor: OrdenacaoLista | undefined, ordem: DirecaoOrdenacao | undefined): string {
  if (!ordenarPor || !ordem) return '';
  const encontrada = OPCOES_ORDENACAO.find((opcao) => opcao.ordenarPor === ordenarPor && opcao.ordem === ordem);
  return encontrada?.chave ?? '';
}

const CLASSE_CAMPO =
  'h-10 px-3 rounded-lg bg-surface-subtle text-text-primary font-label-md text-label-md focus:outline-none shadow-sm';

export function FiltrosLista({ valor, responsaveis, origens, onMudar, onLimpar }: FiltrosListaProps) {
  return (
    <div className="p-space-md rounded-xl bg-surface-card shadow-sm">
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-space-sm">
        <input
          type="text"
          value={valor.busca}
          onChange={(evento) => onMudar({ busca: evento.target.value })}
          placeholder="Buscar por nome, e-mail ou telefone..."
          aria-label="Buscar"
          className={`${CLASSE_CAMPO} flex-1 max-w-xl`}
        />
        <select
          aria-label="Etapa"
          value={valor.etapaId ?? ''}
          onChange={(evento) => onMudar({ etapaId: evento.target.value ? Number(evento.target.value) : undefined })}
          className={CLASSE_CAMPO}
        >
          <option value="">Todas as etapas</option>
          {ETAPAS_LISTA.map((etapa) => (
            <option key={etapa.id} value={etapa.id}>
              {etapa.nome}
            </option>
          ))}
        </select>
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
          <option value="">Todas as origens</option>
          {origens.map((origem) => (
            <option key={origem} value={origem}>
              {origem}
            </option>
          ))}
        </select>
        <select
          aria-label="Ordenar por"
          value={chaveDaOrdenacao(valor.ordenarPor, valor.ordem)}
          onChange={(evento) => {
            const opcao = OPCOES_ORDENACAO.find((item) => item.chave === evento.target.value);
            onMudar({ ordenarPor: opcao?.ordenarPor, ordem: opcao?.ordem });
          }}
          className={CLASSE_CAMPO}
        >
          <option value="">Mais recentes primeiro</option>
          {OPCOES_ORDENACAO.map((opcao) => (
            <option key={opcao.chave} value={opcao.chave}>
              {opcao.rotulo}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onLimpar}
          title="Limpar filtros"
          className="h-10 px-3 rounded-lg bg-surface-subtle hover:bg-surface-container text-text-secondary hover:text-text-primary flex items-center justify-center transition-colors"
        >
          Limpar
        </button>
      </div>
    </div>
  );
}
