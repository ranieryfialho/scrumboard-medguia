// T-163 (fase4-pipeline-telas, US-109, AC-408): "Linha de Tempo de
// Atividades" do detalhe — consome `GET /api/oportunidades/:id/linha-do-tempo`
// (T-157), já com os eventos do mais novo para o mais antigo e a contagem
// total de interações. Os filtros abaixo de "Todos" usam só os `tipo`
// gravados de fato pelo sistema (`transicao_etapa`, `anotacao`,
// `conexao_whatsapp` — ver `src/repositories/linha-do-tempo.ts`); não há
// filtro de "Ligações" porque não existe esse tipo de evento ainda (nenhum
// bloco "em breve" aqui: a linha do tempo inteira já é dado real, só o
// recorte de filtro é que fica restrito ao que existe).
'use client';

import { useCallback, useEffect, useState } from 'react';

import { EsqueletoCarregando, EstadoErro, EstadoVazio } from '@/components/pipeline/pecas/estados';

interface ItemLinhaDoTempo {
  id: string;
  tipo: string;
  texto: string;
  autorNome: string;
  ocorridoEm: string;
}

interface RespostaLinhaDoTempo {
  itens: ItemLinhaDoTempo[];
  totalInteracoes: number;
}

interface FiltroPill {
  chave: string;
  rotulo: string;
  tipo: string | undefined;
}

const FILTROS: FiltroPill[] = [
  { chave: 'todos', rotulo: 'Todos', tipo: undefined },
  { chave: 'etapas', rotulo: 'Etapas', tipo: 'transicao_etapa' },
  { chave: 'notas', rotulo: 'Notas', tipo: 'anotacao' },
  { chave: 'whatsapp', rotulo: 'WhatsApp', tipo: 'conexao_whatsapp' },
];

const ICONES: Record<string, string> = {
  transicao_etapa: 'published_with_changes',
  anotacao: 'note_alt',
  cadencia_iniciada: 'bolt',
  atividade_concluida: 'task_alt',
  cadencia_esgotada: 'hourglass_disabled',
  cadencia_dia_avancado: 'update',
  conexao_whatsapp: 'chat',
  fechamento_registrado: 'handshake',
  reatribuicao: 'swap_horiz',
  edicao_card: 'edit_note',
  dossie_exportado: 'folder_zip',
  evidencia_marcada: 'verified',
  evidencia_removida: 'remove_done',
  anexo_excluido: 'delete',
};

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

interface LinhaDoTempoProps {
  oportunidadeId: string;
  /** Muda a cada anotação registrada, para recarregar sem esperar o próximo efeito. */
  versao: number;
}

const VISIVEIS_NO_INICIO = 10;
const VISIVEIS_POR_CLIQUE = 10;

/** AC-408: histórico real do card, do mais novo ao mais antigo, com o filtro "Todos" e a contagem de interações. Em telas largas a lista ocupa o que sobra até o fim da coluna da esquerda (as duas terminam alinhadas), com rolagem só nela; no celular tem altura máxima; o "Ver mais" fica no fim dela. */
export function LinhaDoTempo({ oportunidadeId, versao }: LinhaDoTempoProps) {
  const [filtro, setFiltro] = useState<FiltroPill>(FILTROS[0]);
  const [itens, setItens] = useState<ItemLinhaDoTempo[]>([]);
  const [totalInteracoes, setTotalInteracoes] = useState<number | null>(null);
  const [paginasCarregadas, setPaginasCarregadas] = useState(0);
  const [visiveis, setVisiveis] = useState(VISIVEIS_NO_INICIO);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState(false);

  const buscarPagina = useCallback(
    async (pagina: number): Promise<RespostaLinhaDoTempo> => {
      const query = new URLSearchParams({ pagina: String(pagina) });
      if (filtro.tipo) query.set('tipo', filtro.tipo);
      const resposta = await fetch(`/api/oportunidades/${oportunidadeId}/linha-do-tempo?${query.toString()}`);
      if (!resposta.ok) throw new Error(`linha do tempo respondeu ${resposta.status}`);
      return resposta.json();
    },
    [oportunidadeId, filtro]
  );

  // Recomeça da primeira página ao trocar o filtro ou quando algo novo é registrado.
  const carregar = useCallback(async () => {
    setErro(false);
    setCarregando(true);
    try {
      const primeira = await buscarPagina(1);
      setItens(primeira.itens);
      setTotalInteracoes(primeira.totalInteracoes);
      setPaginasCarregadas(1);
      setVisiveis(VISIVEIS_NO_INICIO);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [buscarPagina]);

  useEffect(() => {
    carregar();
  }, [carregar, versao]);

  const total = totalInteracoes ?? 0;
  const restantes = total - Math.min(visiveis, itens.length);

  // "Ver mais": mostra mais 10 dos já carregados; se faltar, busca a próxima página (20 por vez) antes.
  async function verMais() {
    const alvo = visiveis + VISIVEIS_POR_CLIQUE;
    if (alvo > itens.length && itens.length < total) {
      setCarregandoMais(true);
      try {
        const proxima = await buscarPagina(paginasCarregadas + 1);
        setItens((atuais) => [...atuais, ...proxima.itens]);
        setPaginasCarregadas((n) => n + 1);
      } catch {
        setErro(true);
        setCarregandoMais(false);
        return;
      }
      setCarregandoMais(false);
    }
    setVisiveis(alvo);
  }

  return (
    <div className="bg-surface-card rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md lg:flex-1 lg:min-h-[20rem]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm border-b border-border-subtle pb-space-sm">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-primary text-[22px]">
            history
          </span>
          <h2 className="font-headline-sm text-headline-sm text-text-primary">Linha do Tempo de Atividades</h2>
          {totalInteracoes !== null && (
            <span className="px-2 py-0.5 rounded-full bg-surface-subtle text-text-muted font-label-sm font-semibold">
              {totalInteracoes} interações
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {FILTROS.map((item) => (
            <button
              key={item.chave}
              type="button"
              aria-pressed={filtro.chave === item.chave}
              onClick={() => setFiltro(item)}
              className={
                filtro.chave === item.chave
                  ? 'px-2.5 py-1 rounded-full text-[11px] font-label-sm font-semibold bg-primary text-on-primary'
                  : 'px-2.5 py-1 rounded-full text-[11px] font-label-sm text-text-secondary hover:bg-surface-subtle'
              }
            >
              {item.rotulo}
            </button>
          ))}
        </div>
      </div>

      {carregando && <EsqueletoCarregando linhas={3} />}
      {!carregando && erro && <EstadoErro onTentarDeNovo={carregar} />}
      {!carregando && !erro && itens.length === 0 && <EstadoVazio titulo="Nenhuma interação ainda" icone="history" />}
      {!carregando && !erro && itens.length > 0 && (
        <div className="max-h-[28rem] overflow-y-auto pr-2 lg:max-h-none lg:flex-1 lg:min-h-0 lg:[contain:size]" tabIndex={0} aria-label="Eventos da linha do tempo">
          <div className="relative pl-6 space-y-3 before:content-[''] before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-surface-container">
            {itens.slice(0, visiveis).map((item) => (
              <div key={item.id} className="relative">
                <span className="absolute -left-6 top-1.5 w-5 h-5 rounded-full bg-surface-container text-text-secondary flex items-center justify-center ring-4 ring-surface-card shadow-sm">
                  <span aria-hidden="true" className="material-symbols-outlined text-[13px]">
                    {ICONES[item.tipo] ?? 'circle'}
                  </span>
                </span>
                <div className="bg-surface-subtle px-space-md py-2 rounded-lg">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-label-lg font-semibold text-text-primary">{item.autorNome}</span>
                    <span className="font-body-sm text-text-secondary leading-snug">{item.texto}</span>
                  </div>
                  <span className="font-label-sm text-text-muted">{formatarData(item.ocorridoEm)}</span>
                </div>
              </div>
            ))}
          </div>
          {restantes > 0 && (
            <button
              type="button"
              onClick={verMais}
              disabled={carregandoMais}
              className="mt-3 mx-auto block px-3 py-1.5 rounded-full text-[12px] font-label-sm font-semibold text-primary hover:bg-surface-subtle disabled:opacity-60"
            >
              {carregandoMais ? 'Carregando...' : `Ver mais (${restantes})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
