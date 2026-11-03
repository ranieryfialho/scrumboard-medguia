'use client';

// T-162 (fase4-pipeline-telas, US-108): tela dos arquivados — fonte visual
// `docs/ui/stitch_medcrm_interface_design/8._pipeline_arquivados_cards_arquivados/`.
// Vive no grupo `(app)` (`src/app/(app)/layout.tsx`, T-146) — a casca (menu
// com "Arquivados" marcado, topo) vem de lá; esta tela só entra como
// conteúdo. As abas Todos/Ganhos/Perdidos (AC-400), a tabela (AC-401) e os
// indicadores com a distribuição de motivos (AC-403) vêm de
// `GET /api/oportunidades/arquivados` e
// `GET /api/pipeline/indicadores?visao=arquivados` (T-154/T-155), já
// filtrados e paginados no servidor; esta tela só lê o que vem pronto. O
// texto das abas segue o critério de aceite ("Todos", "Ganhos", "Perdidos"),
// não os rótulos maiores do protótipo (ASM-132/decisão de 23/10: o banco e
// a spec mandam, não o texto fictício do Stitch). "Reabrir" (AC-404) fica
// desabilitado para quem não é MASTER/GERENTE — o papel vem de
// `GET /api/me` (mesma rota que `src/app/(app)/layout.tsx` já usa para a
// casca). Os blocos sem backend (AC-405: Análise de
// Motivos de Perda, Top Fechamentos do Trimestre, Playbook de Reversão)
// usam `ItemEmBreve`/`SeloEmBreve` de T-158.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { EsqueletoCarregando, EstadoErro, EstadoVazio } from '@/components/pipeline/pecas/estados';
import { Paginacao } from '@/components/pipeline/pecas/paginacao';
import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { BotaoExportar } from '@/components/pipeline/lote/botao-exportar';
import { TabelaArquivados, type ItemTabelaArquivados } from '@/components/pipeline/tabela-arquivados';
import {
  FiltrosArquivados,
  filtroArquivadosAtivo,
  type OpcaoFiltroArquivados,
  type ValorFiltrosArquivados,
} from '@/components/pipeline/filtros-arquivados';
import { DistribuicaoMotivos, type MotivoDistribuicaoView } from '@/components/pipeline/distribuicao-motivos';

type TamanhoPagina = 10 | 25 | 50;
const TAMANHOS_PAGINA: readonly TamanhoPagina[] = [10, 25, 50];

type Aba = 'todos' | 'ganhos' | 'perdidos';

/** AC-400: ordem e rótulos exatos dos três critérios de aceite — não os textos maiores do protótipo. */
const ABAS: { chave: Aba; rotulo: string; icone: string }[] = [
  { chave: 'todos', rotulo: 'Todos', icone: 'inventory_2' },
  { chave: 'ganhos', rotulo: 'Ganhos', icone: 'verified' },
  { chave: 'perdidos', rotulo: 'Perdidos', icone: 'cancel' },
];

function abaValida(valor: string | null): Aba {
  return valor === 'ganhos' || valor === 'perdidos' ? valor : 'todos';
}

function tipoDaAba(aba: Aba): 'ganho' | 'perdido' | undefined {
  if (aba === 'ganhos') return 'ganho';
  if (aba === 'perdidos') return 'perdido';
  return undefined;
}

function normalizarPorPagina(valor: string | null): TamanhoPagina {
  const numero = Number(valor);
  return numero === 10 || numero === 25 || numero === 50 ? numero : 10;
}

interface RespostaArquivados {
  itens: ItemTabelaArquivados[];
  total: number;
  pagina: number;
  porPagina: TamanhoPagina;
}

interface IndicadorNullSafe {
  valor: number | null;
}

interface RespostaIndicadoresArquivados {
  valorGanho: string;
  negociosFechados: number;
  conversaoFinal: IndicadorNullSafe;
  perdas: { quantidade: number; taxaPerda: IndicadorNullSafe };
  distribuicaoMotivos: MotivoDistribuicaoView[];
}

interface UsuarioSessaoMinima {
  papel?: string;
  isSuperAdmin?: boolean;
}

function construirQuery(
  tipo: 'ganho' | 'perdido' | undefined,
  pagina: number,
  porPagina: number,
  filtro?: ValorFiltrosArquivados
): string {
  const parametros = new URLSearchParams();
  parametros.set('pagina', String(pagina));
  parametros.set('porPagina', String(porPagina));
  if (tipo) parametros.set('tipo', tipo);
  if (filtro?.busca) parametros.set('busca', filtro.busca);
  if (filtro?.motivoPerdaId) parametros.set('motivoPerdaId', filtro.motivoPerdaId);
  if (filtro?.responsavelId) parametros.set('responsavelId', filtro.responsavelId);
  if (filtro?.de) parametros.set('de', filtro.de);
  return parametros.toString();
}

function formatarMoeda(valor: string): string {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return 'R$ 0';
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarPercentual(valor: number | null): string {
  if (valor === null) return '—';
  return `${(valor * 100).toFixed(1)}%`;
}

function PipelineArquivadosConteudo() {
  const router = useRouter();
  const searchParamsIniciais = useSearchParams();

  const [aba, setAba] = useState<Aba>(() => abaValida(searchParamsIniciais.get('aba')));
  const [pagina, setPagina] = useState(() => Math.max(1, Number(searchParamsIniciais.get('pagina')) || 1));
  const [porPagina, setPorPagina] = useState<TamanhoPagina>(() =>
    normalizarPorPagina(searchParamsIniciais.get('porPagina'))
  );

  // AC-418: filtros (busca, motivo, consultor, data) — vão para a URL junto com aba e página.
  const [filtro, setFiltro] = useState<ValorFiltrosArquivados>(() => ({
    busca: searchParamsIniciais.get('busca') ?? '',
    motivoPerdaId: searchParamsIniciais.get('motivoPerdaId') ?? undefined,
    responsavelId: searchParamsIniciais.get('responsavelId') ?? undefined,
    de: searchParamsIniciais.get('de') ?? undefined,
  }));
  const [opcoesFiltro, setOpcoesFiltro] = useState<{ motivos: OpcaoFiltroArquivados[]; responsaveis: OpcaoFiltroArquivados[] }>({
    motivos: [],
    responsaveis: [],
  });

  const [dados, setDados] = useState<RespostaArquivados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);

  const [contagens, setContagens] = useState<Record<Aba, number>>({ todos: 0, ganhos: 0, perdidos: 0 });
  const [indicadores, setIndicadores] = useState<RespostaIndicadoresArquivados | null>(null);
  const [podeReabrir, setPodeReabrir] = useState(false);
  const [versao, setVersao] = useState(0);

  const tipo = tipoDaAba(aba);
  const query = useMemo(() => construirQuery(tipo, pagina, porPagina, filtro), [tipo, pagina, porPagina, filtro]);
  // AC-456: a exportação leva a aba e os filtros da tela, mas não a página.
  const consultaDaExportacao = useMemo(() => {
    const parametros = new URLSearchParams(query);
    parametros.delete('pagina');
    parametros.delete('porPagina');
    return parametros.toString();
  }, [query]);

  const carregar = useCallback(async () => {
    setErro(false);
    setCarregando(true);
    try {
      const resposta = await fetch(`/api/oportunidades/arquivados?${query}`);
      if (!resposta.ok) throw new Error(`arquivados respondeu ${resposta.status}`);
      const corpo = (await resposta.json()) as RespostaArquivados;
      setDados(corpo);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [query]);

  useEffect(() => {
    carregar();
  }, [carregar, versao]);

  useEffect(() => {
    router.replace(`/pipeline/arquivados?aba=${aba}&${query}`);
  }, [aba, query, router]);

  // AC-400: a contagem de cada uma das três abas, não só a ativa.
  useEffect(() => {
    let cancelado = false;

    async function buscarTotal(tipoDaBusca: 'ganho' | 'perdido' | undefined): Promise<number> {
      const resposta = await fetch(`/api/oportunidades/arquivados?${construirQuery(tipoDaBusca, 1, 10)}`);
      if (!resposta.ok) return 0;
      const corpo = (await resposta.json()) as RespostaArquivados;
      return corpo.total;
    }

    async function carregarContagens() {
      const [todos, ganhos, perdidos] = await Promise.all([
        buscarTotal(undefined),
        buscarTotal('ganho'),
        buscarTotal('perdido'),
      ]);
      if (!cancelado) setContagens({ todos, ganhos, perdidos });
    }

    carregarContagens();
    return () => {
      cancelado = true;
    };
  }, [versao]);

  // AC-403: os quatro indicadores e a distribuição de motivos de perda.
  useEffect(() => {
    let cancelado = false;
    fetch('/api/pipeline/indicadores?visao=arquivados')
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo: RespostaIndicadoresArquivados | null) => {
        if (!cancelado) setIndicadores(corpo);
      })
      .catch(() => {
        if (!cancelado) setIndicadores(null);
      });
    return () => {
      cancelado = true;
    };
  }, [versao]);

  // AC-404: só MASTER/GERENTE (ou super admin) veem "Reabrir" habilitado — a API confere de novo (403), esta checagem é só da UI.
  useEffect(() => {
    let cancelado = false;
    fetch('/api/me')
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((usuario: UsuarioSessaoMinima | null) => {
        if (cancelado || !usuario) return;
        setPodeReabrir(usuario.isSuperAdmin === true || usuario.papel === 'MASTER' || usuario.papel === 'GERENTE');
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  // AC-418: opções dos selects — motivos cadastrados e consultores que aparecem nos arquivados.
  useEffect(() => {
    let cancelado = false;
    Promise.all([
      fetch('/api/motivos-perda').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/oportunidades/arquivados?porPagina=50').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([motivos, arquivados]: [{ itens: OpcaoFiltroArquivados[] } | null, RespostaArquivados | null]) => {
        if (cancelado) return;
        const consultores = new Map<string, string>();
        for (const item of arquivados?.itens ?? []) {
          if (item.responsavel) consultores.set(item.responsavel.id, item.responsavel.nome);
        }
        setOpcoesFiltro({
          motivos: motivos?.itens ?? [],
          responsaveis: [...consultores.entries()].map(([id, nome]) => ({ id, nome })),
        });
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  function mudarFiltro(parcial: Partial<ValorFiltrosArquivados>) {
    setFiltro((atual) => ({ ...atual, ...parcial }));
    setPagina(1);
  }

  function limparFiltro() {
    setFiltro({ busca: '' });
    setPagina(1);
  }

  function mudarAba(novaAba: Aba) {
    setAba(novaAba);
    setPagina(1);
  }

  function mudarPorPagina(novoValor: TamanhoPagina) {
    setPorPagina(novoValor);
    setPagina(1);
  }

  function aoReaberto() {
    setVersao((atual) => atual + 1);
  }

  return (
    // AC-735: altura da tela (menos o topo); só a tabela rola por dentro.
    <div className="p-space-md flex flex-col gap-space-md h-[calc(100dvh-4rem)] min-h-[48rem]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">
            Cards Arquivados (Fechamentos)
          </h1>
          <p className="font-body-md text-body-md text-text-secondary mt-0.5">
            Histórico de negociações finalizadas: oportunidades ganhas e leads desqualificados ou perdidos
          </p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          {/* AC-457: só MASTER/GERENTE exportam; a API confere de novo. */}
          {podeReabrir && <BotaoExportar tela="arquivados" consulta={consultaDaExportacao} />}
          <ItemEmBreve
            rotulo="Análise de Motivos de Perda"
            icone="query_stats"
            className="px-3.5 py-2 rounded-lg bg-surface-card shadow-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
        {indicadores ? (
          <>
            <CartaoIndicador
              titulo="Total Ganho"
              valor={formatarMoeda(indicadores.valorGanho)}
              legenda="/mês"
              icone="attach_money"
              cor="success"
            />
            <CartaoIndicador
              titulo="Negócios Fechados"
              valor={String(indicadores.negociosFechados)}
              legenda="contratos"
              icone="verified"
              cor="primary"
            />
            <CartaoIndicador
              titulo="Conversão Final"
              valor={formatarPercentual(indicadores.conversaoFinal.valor)}
              legenda={`${indicadores.negociosFechados} finalizados`}
              icone="pie_chart"
              cor="info"
            />
            <CartaoIndicador
              titulo="Perdas no Mês"
              valor={String(indicadores.perdas.quantidade)}
              legenda={`Taxa de perda: ${formatarPercentual(indicadores.perdas.taxaPerda.valor)}`}
              icone="person_off"
              cor="danger"
            />
          </>
        ) : (
          <EsqueletoCarregando linhas={1} />
        )}
      </div>

      <div className="bg-surface-card rounded-2xl shadow-sm p-space-md flex flex-col gap-space-md flex-1 min-h-0">
        <div className="flex items-center bg-surface-subtle p-1 rounded-xl self-start gap-1">
          {ABAS.map((item) => (
            <button
              key={item.chave}
              type="button"
              onClick={() => mudarAba(item.chave)}
              aria-pressed={aba === item.chave}
              className={
                aba === item.chave
                  ? 'px-4 py-2 rounded-lg font-label-lg text-label-lg bg-surface-card text-primary shadow-sm font-bold flex items-center gap-2'
                  : 'px-4 py-2 rounded-lg font-label-lg text-label-lg text-text-secondary hover:text-text-primary flex items-center gap-2 transition-colors'
              }
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                {item.icone}
              </span>
              <span>{item.rotulo}</span>
              <span className="bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full text-[11px]">
                {contagens[item.chave]}
              </span>
            </button>
          ))}
        </div>

        <FiltrosArquivados
          valor={filtro}
          motivos={opcoesFiltro.motivos}
          responsaveis={opcoesFiltro.responsaveis}
          onMudar={mudarFiltro}
          onLimpar={limparFiltro}
        />

        {carregando && <EsqueletoCarregando />}
        {!carregando && erro && <EstadoErro onTentarDeNovo={carregar} />}
        {!carregando && !erro && dados && dados.total === 0 && (
          <EstadoVazio
            titulo={filtroArquivadosAtivo(filtro) ? 'Nenhum card arquivado com estes filtros' : 'Nenhum card arquivado ainda'}
            proximoPasso={
              filtroArquivadosAtivo(filtro) ? 'tente mudar ou limpar os filtros' : 'feche ou perca um card no funil'
            }
            icone="archive"
          />
        )}
        {!carregando && !erro && dados && dados.total > 0 && (
          <div className="flex-1 min-h-0 flex flex-col gap-space-md">
            <TabelaArquivados itens={dados.itens} podeReabrir={podeReabrir} onReaberto={aoReaberto} />
            <div className="px-space-md py-2 flex items-center gap-1.5 flex-shrink-0">
              <label htmlFor="pipeline-arquivados-exibir" className="font-body-sm text-body-sm text-text-muted">
                Exibir:
              </label>
              <select
                id="pipeline-arquivados-exibir"
                value={dados.porPagina}
                onChange={(evento) => mudarPorPagina(Number(evento.target.value) as TamanhoPagina)}
                className="h-7 px-2 rounded bg-surface-subtle text-text-primary font-label-sm text-label-sm focus:outline-none"
              >
                {TAMANHOS_PAGINA.map((tamanho) => (
                  <option key={tamanho} value={tamanho}>
                    {tamanho} por página
                  </option>
                ))}
              </select>
            </div>
            <Paginacao
              pagina={dados.pagina}
              porPagina={dados.porPagina}
              total={dados.total}
              onMudarPagina={setPagina}
              rotuloItem="arquivados"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md flex-shrink-0">
        <DistribuicaoMotivos motivos={indicadores?.distribuicaoMotivos ?? []} />

        <div className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-headline-sm text-headline-sm text-text-primary">Top Fechamentos do Trimestre</h3>
            <span aria-hidden="true" className="material-symbols-outlined text-success-text text-[20px]">
              workspace_premium
            </span>
          </div>
          <ItemEmBreve rotulo="Top Fechamentos do Trimestre" icone="workspace_premium" />
        </div>

        <div className="bg-sidebar-surface rounded-2xl p-space-md text-surface flex flex-col gap-space-sm">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm px-2.5 py-0.5 rounded-full bg-primary-container text-surface-container-lowest font-bold uppercase tracking-wider">
              Playbook de Reversão
            </span>
            <span aria-hidden="true" className="material-symbols-outlined text-primary-fixed-dim text-[20px]">
              auto_stories
            </span>
          </div>
          <ItemEmBreve rotulo="Playbook de Reversão" icone="forward_to_inbox" className="text-surface" />
        </div>
      </div>
    </div>
  );
}

export default function PipelineArquivadosPage() {
  return (
    <Suspense fallback={null}>
      <PipelineArquivadosConteudo />
    </Suspense>
  );
}
