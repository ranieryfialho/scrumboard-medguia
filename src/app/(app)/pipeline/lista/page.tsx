'use client';

// T-161 (fase4-pipeline-telas, US-107): tela da lista — fonte visual
// `docs/ui/stitch_medcrm_interface_design/7._pipeline_lista_vis_o_em_lista/`.
// Vive no grupo `(app)` (`src/app/(app)/layout.tsx`, T-146) — a casca (menu
// com "Lista" marcado via `menu-config.ts`, já com o item, e topo) vem de
// lá; esta tela só entra como conteúdo (AC-394). O filtro, a ordenação e a
// paginação em si são do servidor (`GET /api/oportunidades/lista`,
// T-154/T-155, AC-395/AC-396); aqui só monta a query a partir do estado dos
// filtros e lê a resposta já pronta. Estado dos filtros e da página também
// vai para a URL (`router.replace`), para recarregar e compartilhar o link
// (nota da tarefa) — sem isso bloquear nenhum critério: a leitura inicial
// cai para os defaults se a URL não tiver nada.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { EsqueletoCarregando, EstadoErro, EstadoVazio } from '@/components/pipeline/pecas/estados';
import { Paginacao } from '@/components/pipeline/pecas/paginacao';
import { IndicadoresFunil, type IndicadoresFunilView } from '@/components/pipeline/indicadores-funil';
import { ModalNovoLead, type DadosNovoLead, type ResultadoSalvarNovoLead } from '@/components/pipeline/modal-novo-lead';
import { criarCardNovoLead, criarLeadEIniciarCadencia } from '@/components/pipeline/novo-lead-api';
import { ETAPAS_PIPELINE } from '@/components/pipeline/detalhe/jornada';
import { BarraLote } from '@/components/pipeline/lote/barra-lote';
import { DialogoWhatsappLote } from '@/components/pipeline/lote/dialogo-whatsapp-lote';
import { DialogoLote, type OpcaoDoDialogo } from '@/components/pipeline/lote/dialogo-lote';
import { BotaoExportar } from '@/components/pipeline/lote/botao-exportar';
import { ResultadoLote } from '@/components/pipeline/lote/resultado-lote';
import { DialogoIniciarCadencia } from '@/components/pipeline/lote/dialogo-iniciar-cadencia';
import { iniciarCadenciaEmMassa } from '@/components/pipeline/lote/iniciar-cadencia-api';
import { MENSAGEM_DO_PEDIDO, type AcaoDeResultado, type AcaoEmLote, type ResultadoDoLoteView } from '@/components/pipeline/lote/tipos';
import {
  FiltrosLista,
  type DirecaoOrdenacao,
  type OpcaoResponsavel,
  type OrdenacaoLista,
  type ValorFiltrosLista,
} from '@/components/pipeline/filtros-lista';
import { parametrosDoPeriodoPipeline } from '@/components/pipeline/filtro-periodo-pipeline';
import { lerFiltroDeQualificacao } from '@/domain/qualificacao/qualificacao';
import { TabelaLista, type ItemTabelaLista } from '@/components/pipeline/tabela-lista';

type TamanhoPagina = 10 | 25 | 50;
const TAMANHOS_PAGINA: readonly TamanhoPagina[] = [10, 25, 50];

/** AC-395: só 10/25/50 são aceitos — qualquer outro valor (ou nenhum) vira 10. */
function normalizarPorPagina(valor: string | null): TamanhoPagina {
  const numero = Number(valor);
  return numero === 10 || numero === 25 || numero === 50 ? numero : 10;
}

function normalizarOrdenarPor(valor: string | null): OrdenacaoLista | undefined {
  return valor === 'valor' || valor === 'proximaAcao' || valor === 'criadoEm' ? valor : undefined;
}

function normalizarOrdem(valor: string | null): DirecaoOrdenacao | undefined {
  return valor === 'asc' || valor === 'desc' ? valor : undefined;
}

interface RespostaLista {
  itens: ItemTabelaLista[];
  total: number;
  pagina: number;
  porPagina: TamanhoPagina;
}

function construirQuery(filtro: ValorFiltrosLista, pagina: number, porPagina: number): string {
  const parametros = new URLSearchParams();
  parametros.set('pagina', String(pagina));
  parametros.set('porPagina', String(porPagina));
  if (filtro.busca) parametros.set('busca', filtro.busca);
  if (filtro.etapaId !== undefined) parametros.set('etapaId', String(filtro.etapaId));
  if (filtro.responsavelId) parametros.set('responsavelId', filtro.responsavelId);
  if (filtro.origem) parametros.set('origem', filtro.origem);
  if (filtro.qualificacao) parametros.set('qualificacao', filtro.qualificacao);
  if (filtro.ordenarPor) parametros.set('ordenarPor', filtro.ordenarPor);
  if (filtro.ordem) parametros.set('ordem', filtro.ordem);
  // AC-822: o período (e qual data ele filtra) vai no pedido da lista e, por `consultaDaExportacao`, na exportação.
  for (const [chave, valor] of Object.entries(parametrosDoPeriodoPipeline({ periodo: filtro.periodo, data: filtro.campoData ?? 'entrada' }))) {
    parametros.set(chave, valor);
  }
  return parametros.toString();
}

function PipelineListaConteudo() {
  const router = useRouter();
  const searchParamsIniciais = useSearchParams();

  const [filtro, setFiltro] = useState<ValorFiltrosLista>(() => ({
    busca: searchParamsIniciais.get('busca') ?? '',
    etapaId: searchParamsIniciais.get('etapaId') ? Number(searchParamsIniciais.get('etapaId')) : undefined,
    responsavelId: searchParamsIniciais.get('responsavelId') ?? undefined,
    origem: searchParamsIniciais.get('origem') ?? undefined,
    qualificacao: lerFiltroDeQualificacao(searchParamsIniciais.get('qualificacao')),
    ordenarPor: normalizarOrdenarPor(searchParamsIniciais.get('ordenarPor')),
    ordem: normalizarOrdem(searchParamsIniciais.get('ordem')),
  }));
  const [pagina, setPagina] = useState(() => Math.max(1, Number(searchParamsIniciais.get('pagina')) || 1));
  const [porPagina, setPorPagina] = useState<TamanhoPagina>(() =>
    normalizarPorPagina(searchParamsIniciais.get('porPagina'))
  );

  const [dados, setDados] = useState<RespostaLista | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [opcoes, setOpcoes] = useState<{ responsaveis: OpcaoResponsavel[]; origens: string[] }>({
    responsaveis: [],
    origens: [],
  });
  // AC-417: indicadores do topo (os mesmos do funil) e o modal "Novo Card".
  const [indicadores, setIndicadores] = useState<IndicadoresFunilView | null>(null);
  const [modalNovoCardAberto, setModalNovoCardAberto] = useState(false);
  // T-178 (AC-445 a AC-454): ações em lote sobre os cards selecionados.
  const [podeReatribuir, setPodeReatribuir] = useState(false);
  const [acaoAberta, setAcaoAberta] = useState<AcaoEmLote | null>(null);
  const [disparoAberto, setDisparoAberto] = useState(false); // fase5-whatsapp-lote-disparo (AC-685)
  const [iniciarCadenciaAberto, setIniciarCadenciaAberto] = useState(false); // T-296 (AC-759)
  const [opcoesDoDialogo, setOpcoesDoDialogo] = useState<OpcaoDoDialogo[]>([]);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(false);
  const [aplicandoLote, setAplicandoLote] = useState(false);
  const [erroDoLote, setErroDoLote] = useState<string | null>(null);
  const [resultadoDoLote, setResultadoDoLote] = useState<{
    acao: AcaoDeResultado;
    lote: ResultadoDoLoteView;
    nomes: Record<string, string>;
  } | null>(null);

  const query = useMemo(() => construirQuery(filtro, pagina, porPagina), [filtro, pagina, porPagina]);
  // AC-455: a exportação leva os mesmos filtros e a mesma ordenação da tela, mas não a página.
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
      const resposta = await fetch(`/api/oportunidades/lista?${query}`);
      if (!resposta.ok) throw new Error(`lista respondeu ${resposta.status}`);
      const corpo = (await resposta.json()) as RespostaLista;
      setDados(corpo);
      setSelecionados(new Set());
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [query]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const carregarIndicadores = useCallback(async () => {
    try {
      const resposta = await fetch('/api/pipeline/indicadores?visao=funil');
      if (resposta.ok) setIndicadores(await resposta.json());
    } catch {
      // Indicadores são independentes da tabela: sem eles a lista segue funcionando.
    }
  }, []);

  useEffect(() => {
    void carregarIndicadores();
  }, [carregarIndicadores]);

  // AC-451: só MASTER/GERENTE (ou super admin) reatribuem — a API confere de novo (403).
  useEffect(() => {
    let cancelado = false;
    fetch('/api/me')
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((usuario: { papel?: string; isSuperAdmin?: boolean } | null) => {
        if (cancelado || !usuario) return;
        setPodeReatribuir(usuario.isSuperAdmin === true || usuario.papel === 'MASTER' || usuario.papel === 'GERENTE');
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

  /** Abre o diálogo da ação e carrega as opções dela (etapas já são conhecidas; responsáveis e motivos vêm da API). */
  async function abrirAcao(acao: AcaoEmLote) {
    setErroDoLote(null);
    setResultadoDoLote(null);
    setAcaoAberta(acao);
    if (acao === 'mover') {
      setOpcoesDoDialogo(ETAPAS_PIPELINE.map((etapa) => ({ id: String(etapa.id), nome: etapa.nome })));
      return;
    }
    setOpcoesDoDialogo([]);
    setCarregandoOpcoes(true);
    try {
      if (acao === 'reatribuir') {
        const resposta = await fetch('/api/pipeline/responsaveis');
        const corpo = resposta.ok ? ((await resposta.json()) as { responsaveis: OpcaoDoDialogo[] }) : { responsaveis: [] };
        setOpcoesDoDialogo(corpo.responsaveis);
      } else {
        const resposta = await fetch('/api/motivos-perda');
        const corpo = resposta.ok ? ((await resposta.json()) as { itens: OpcaoDoDialogo[] }) : { itens: [] };
        setOpcoesDoDialogo(corpo.itens);
      }
    } catch {
      setOpcoesDoDialogo([]);
    } finally {
      setCarregandoOpcoes(false);
    }
  }

  /** AC-759/AC-760: inicia a cadência dos selecionados, mostra o resultado e deixa marcados os que falharam. */
  async function iniciarCadenciaDosSelecionados() {
    const ids = [...selecionados];
    const nomes: Record<string, string> = {};
    for (const item of dados?.itens ?? []) nomes[item.id] = item.lead.nome;
    setAplicandoLote(true);
    setErroDoLote(null);
    try {
      const lote = await iniciarCadenciaEmMassa(ids);
      setIniciarCadenciaAberto(false);
      setResultadoDoLote({ acao: 'cadencia', lote, nomes });
      await carregar();
      void carregarIndicadores();
      setSelecionados(new Set(lote.resultados.filter((resultado) => !resultado.ok).map((resultado) => resultado.id)));
    } catch (erro) {
      setErroDoLote(MENSAGEM_DO_PEDIDO[erro instanceof Error ? erro.message : ''] ?? 'Não foi possível iniciar a cadência. Tente de novo.');
    } finally {
      setAplicandoLote(false);
    }
  }

  function fecharDialogo() {
    setAcaoAberta(null);
    setErroDoLote(null);
  }

  /** AC-446/AC-447/AC-450/AC-453: aplica a ação nos selecionados, mostra o resultado e deixa marcados os que falharam. */
  async function aplicarLote(valor: string) {
    if (!acaoAberta) return;
    const acao = acaoAberta;
    const ids = [...selecionados];
    const nomes: Record<string, string> = {};
    for (const item of dados?.itens ?? []) nomes[item.id] = item.lead.nome;

    const corpo =
      acao === 'mover'
        ? { ids, etapaDestinoId: Number(valor) }
        : acao === 'reatribuir'
          ? { ids, responsavelId: valor }
          : { ids, motivoPerdaId: valor };

    setAplicandoLote(true);
    setErroDoLote(null);
    try {
      const resposta = await fetch(`/api/oportunidades/lote/${acao}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      if (!resposta.ok) {
        const erro = (await resposta.json().catch(() => null)) as { codigo?: string } | null;
        setErroDoLote(MENSAGEM_DO_PEDIDO[erro?.codigo ?? ''] ?? 'Não foi possível aplicar a ação. Tente de novo.');
        return;
      }
      const lote = (await resposta.json()) as ResultadoDoLoteView;
      setAcaoAberta(null);
      setResultadoDoLote({ acao, lote, nomes });
      await carregar();
      void carregarIndicadores();
      // Os que falharam continuam marcados para o usuário corrigir.
      setSelecionados(new Set(lote.resultados.filter((resultado) => !resultado.ok).map((resultado) => resultado.id)));
    } catch {
      setErroDoLote('Não foi possível aplicar a ação. Tente de novo.');
    } finally {
      setAplicandoLote(false);
    }
  }

  const aoCriarCard = useCallback(
    async (dados: DadosNovoLead): Promise<ResultadoSalvarNovoLead> => {
      const resultado = await criarCardNovoLead(dados);
      if (!resultado.ok) return { ok: false, erro: resultado.erro, campo: resultado.campo };
      await carregar();
      void carregarIndicadores();
      return { ok: true };
    },
    [carregar, carregarIndicadores]
  );

  const aoCriarCardEIniciarCadencia = useCallback(
    async (dados: DadosNovoLead): Promise<ResultadoSalvarNovoLead> => {
      const resultado = await criarLeadEIniciarCadencia(dados);
      if (!resultado.ok) return { ok: false, erro: resultado.erro, campo: resultado.campo };
      await carregar();
      void carregarIndicadores();
      return { ok: true };
    },
    [carregar, carregarIndicadores]
  );

  useEffect(() => {
    router.replace(`/pipeline/lista?${query}`);
  }, [query, router]);

  // AC-396/ASM-137: sem endpoint próprio de responsáveis/origens — as opções
  // dos selects vêm dos valores que já aparecem na lista (sem filtro, até
  // o maior tamanho de página aceito), não de uma lista oficial.
  useEffect(() => {
    let cancelado = false;
    fetch('/api/oportunidades/lista?porPagina=50')
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo: RespostaLista | null) => {
        if (cancelado || !corpo) return;
        const responsaveis = new Map<string, string>();
        const origens = new Set<string>();
        for (const item of corpo.itens) {
          if (item.responsavel) responsaveis.set(item.responsavel.id, item.responsavel.nome);
        }
        for (const item of corpo.itens as unknown as { lead: { origem?: string | null } }[]) {
          if (item.lead?.origem) origens.add(item.lead.origem);
        }
        setOpcoes({
          responsaveis: [...responsaveis.entries()].map(([id, nome]) => ({ id, nome })),
          origens: [...origens].sort(),
        });
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  function mudarFiltro(patch: Partial<ValorFiltrosLista>) {
    setFiltro((atual) => ({ ...atual, ...patch }));
    setPagina(1);
  }

  function limparFiltro() {
    setFiltro({ busca: '' });
    setPagina(1);
  }

  function mudarPorPagina(novoValor: TamanhoPagina) {
    setPorPagina(novoValor);
    setPagina(1);
  }

  function alternarSelecao(id: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function alternarTodos() {
    setSelecionados((atual) => {
      if (!dados) return atual;
      const todosMarcados = dados.itens.length > 0 && dados.itens.every((item) => atual.has(item.id));
      return todosMarcados ? new Set() : new Set(dados.itens.map((item) => item.id));
    });
  }

  return (
    // AC-734: altura da tela (menos o topo); só a tabela rola por dentro.
    <div className="p-space-md flex flex-col gap-space-md h-[calc(100dvh-4rem)] min-h-[40rem]">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Pipeline em Lista</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-xl">
            Gerenciamento estruturado de leads e clínicas em prospecção, com visão tabular.
          </p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          {indicadores && (
            <span className="h-10 px-4 rounded-xl bg-surface-card shadow-sm flex items-center gap-2 font-body-md text-body-md text-text-secondary">
              <span aria-hidden="true" className="w-2 h-2 rounded-full bg-primary" />
              <span>
                Total: <strong className="text-text-primary">{indicadores.cardsAtivos.quantidade} leads</strong> (
                {Number(indicadores.cardsAtivos.valorTotal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})
              </span>
            </span>
          )}
          {/* AC-457: só MASTER/GERENTE exportam (dado pessoal em massa); a API confere de novo. */}
          {podeReatribuir && <BotaoExportar tela="lista" consulta={consultaDaExportacao} />}
          <Link
            href="/pipeline"
            className="h-10 px-4 rounded-xl bg-surface-card hover:bg-surface-subtle shadow-sm flex items-center gap-2 font-label-md text-label-md font-semibold text-text-primary transition-colors"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[19px]">
              view_kanban
            </span>
            Alternar para Funil Kanban
          </Link>
          <button
            type="button"
            onClick={() => setModalNovoCardAberto(true)}
            className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-2 transition-all"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[19px]">
              add
            </span>
            Novo Card
          </button>
        </div>
      </div>

      {indicadores && <IndicadoresFunil dados={indicadores} />}

      {resultadoDoLote && (
        <ResultadoLote
          acao={resultadoDoLote.acao}
          lote={resultadoDoLote.lote}
          nomes={resultadoDoLote.nomes}
          onFechar={() => setResultadoDoLote(null)}
        />
      )}

      <FiltrosLista
        valor={filtro}
        responsaveis={opcoes.responsaveis}
        origens={opcoes.origens}
        onMudar={mudarFiltro}
        onLimpar={limparFiltro}
      />

      {carregando && <EsqueletoCarregando />}
      {!carregando && erro && <EstadoErro onTentarDeNovo={carregar} />}
      {!carregando && !erro && dados && dados.total === 0 && (
        <EstadoVazio titulo="Nenhum lead ainda" proximoPasso="crie o primeiro no Funil Pipeline" />
      )}
      {!carregando && !erro && dados && dados.total > 0 && (
        <div className="flex-1 min-h-0 flex flex-col gap-space-md">
          <TabelaLista
            itens={dados.itens}
            selecionados={selecionados}
            onAlternarSelecao={alternarSelecao}
            onAlternarTodos={alternarTodos}
            barraDeAcoes={<BarraLote quantidade={selecionados.size} podeReatribuir={podeReatribuir} onAbrir={abrirAcao} onDispararWhatsapp={() => setDisparoAberto(true)} onIniciarCadencia={() => { setErroDoLote(null); setIniciarCadenciaAberto(true); }} />}
          />
          <div className="px-space-md py-2 flex items-center gap-1.5 flex-shrink-0">
            <label htmlFor="pipeline-lista-exibir" className="font-body-sm text-body-sm text-text-muted">
              Exibir:
            </label>
            <select
              id="pipeline-lista-exibir"
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
            rotuloItem="leads"
          />
        </div>
      )}

      {iniciarCadenciaAberto && (
        <DialogoIniciarCadencia
          quantidade={selecionados.size}
          enviando={aplicandoLote}
          erro={erroDoLote}
          onConfirmar={() => void iniciarCadenciaDosSelecionados()}
          onFechar={() => setIniciarCadenciaAberto(false)}
        />
      )}

      {disparoAberto && <DialogoWhatsappLote oportunidadeIds={[...selecionados]} onFechar={() => setDisparoAberto(false)} />}

      {acaoAberta && (
        <DialogoLote
          key={acaoAberta}
          acao={acaoAberta}
          quantidade={selecionados.size}
          opcoes={opcoesDoDialogo}
          carregandoOpcoes={carregandoOpcoes}
          enviando={aplicandoLote}
          erro={erroDoLote}
          onConfirmar={aplicarLote}
          onFechar={fecharDialogo}
        />
      )}

      <ModalNovoLead
        aberto={modalNovoCardAberto}
        origens={opcoes.origens}
        responsaveis={opcoes.responsaveis}
        onFechar={() => setModalNovoCardAberto(false)}
        onCriar={aoCriarCard}
        onCriarEIniciarCadencia={aoCriarCardEIniciarCadencia}
      />
    </div>
  );
}

export default function PipelineListaPage() {
  return (
    <Suspense fallback={null}>
      <PipelineListaConteudo />
    </Suspense>
  );
}
