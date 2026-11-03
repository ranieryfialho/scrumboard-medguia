"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";

import type { CodigoErroTransicao } from "@/domain/pipeline/tipos";
import { exigeDadoFaltante } from "@/domain/pipeline/classificar-erro-transicao";
import {
  useStreamOportunidades,
  type EventoOportunidadeMovidaCliente,
  type EventoStreamCliente,
} from "@/hooks/use-stream-oportunidades";
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from "@/components/pipeline/pecas/estados";
import { AvisoTempoReal } from "@/components/pipeline/pecas/aviso-tempo-real";
import { DialogoIniciarCadencia } from "@/components/pipeline/lote/dialogo-iniciar-cadencia";
import { iniciarCadenciaEmMassa } from "@/components/pipeline/lote/iniciar-cadencia-api";
import { ResultadoLote } from "@/components/pipeline/lote/resultado-lote";
import { MENSAGEM_DO_PEDIDO, type ResultadoDoLoteView } from "@/components/pipeline/lote/tipos";
import { CardOportunidade, type CardBoard } from "./card-oportunidade";
import { ColunaEtapa } from "./coluna-etapa";
import { ModalDadoFaltante } from "./modal-dado-faltante";
import { FiltrosFunil, type OpcaoResponsavelFunil, type ValorFiltrosFunil } from "./filtros-funil";
import { IndicadoresFunil, type IndicadoresFunilView } from "./indicadores-funil";
import { ModalNovoLead, type DadosNovoLead, type ResultadoSalvarNovoLead } from "./modal-novo-lead";
import { criarCardNovoLead, criarLeadEIniciarCadencia } from "./novo-lead-api";

const ETAPA_ENTRADA_DE_LEADS = 1;

// Espelha `pipeline_etapas` (drizzle/0005_seeds.sql) — as 15 etapas são seed
// fixo, versionado por migration; não vale buscar isso por rede toda vez.
const ETAPAS: { id: number; nome: string }[] = [
  { id: 1, nome: "Entrada de leads" },
  { id: 2, nome: "1º dia de contato" },
  { id: 3, nome: "2º dia de contato" },
  { id: 4, nome: "3º dia de contato" },
  { id: 5, nome: "Qualificando" },
  { id: 6, nome: "Qualificado p/ reunião" },
  { id: 7, nome: "Follow de longo prazo" },
  { id: 8, nome: "Reunião agendada" },
  { id: 9, nome: "No-show" },
  { id: 10, nome: "Reunião realizada" },
  { id: 11, nome: "Proposta" },
  { id: 12, nome: "Teste (Trial)" },
  { id: 13, nome: "Negociação" },
  { id: 14, nome: "Perdido" },
  { id: 15, nome: "Contrato (Ganho)" },
];

const MENSAGENS_ERRO: Partial<Record<CodigoErroTransicao, string>> = {
  TRANSICAO_NAO_PERMITIDA: "Essa etapa não pode ser alcançada a partir da etapa atual.",
  PAPEL_NAO_PERMITIDO: "Seu papel não tem permissão para fazer essa transição.",
};

interface DadoFaltantePendente {
  oportunidadeId: string;
  etapaDestinoId: number;
  version: number;
  codigo: CodigoErroTransicao;
}

interface ItemPaginaComOrigem {
  id: string;
  origem: string | null;
}

/**
 * AC-390: uma página de `/api/oportunidades/lista` ou `/api/oportunidades/arquivados`
 * — já filtrada e paginada no servidor (T-154/T-155). Usada tanto para
 * montar as opções dos selects (sem filtro) quanto para calcular quais ids
 * um filtro ativo permite no quadro — nunca para substituir `/api/oportunidades`
 * como fonte dos cards (só ela tem `version`, essencial pro arrastar e pro
 * "iniciar cadência").
 */
async function buscarPaginas(
  url: string,
  parametrosBase: Record<string, string | undefined>
): Promise<ItemPaginaComOrigem[]> {
  const resultado: ItemPaginaComOrigem[] = [];
  const porPagina = 50;

  for (let pagina = 1; pagina <= 20; pagina += 1) {
    const parametros = new URLSearchParams();
    for (const [chave, valor] of Object.entries(parametrosBase)) {
      if (valor) parametros.set(chave, valor);
    }
    parametros.set("pagina", String(pagina));
    parametros.set("porPagina", String(porPagina));

    let resposta: Response;
    try {
      resposta = await fetch(`${url}?${parametros.toString()}`);
    } catch {
      break;
    }
    if (!resposta.ok) break;

    const corpo = await resposta.json().catch(() => null);
    const itens = (corpo?.itens ?? []) as { id: string; lead?: { origem?: string | null } }[];
    for (const item of itens) resultado.push({ id: item.id, origem: item.lead?.origem ?? null });

    if (itens.length === 0 || resultado.length >= (corpo?.total ?? 0)) break;
  }

  return resultado;
}

function filtroFunilAtivo(filtro: ValorFiltrosFunil): boolean {
  return filtro.busca.trim() !== "" || !!filtro.responsavelId || !!filtro.origem;
}

/**
 * AC-390: restringe o quadro por responsável, origem e busca de texto.
 * Reaproveita o filtro já pronto no servidor de `listarLista` (etapas 1-13,
 * com origem) e `listarArquivados` (etapas 14/15 — sem filtro de origem no
 * servidor, aplicado aqui sobre `lead.origem` de cada item) em vez de
 * duplicar a regra ou exigir mudança nas rotas de leitura do board.
 */
async function buscarIdsPermitidos(filtro: ValorFiltrosFunil): Promise<Set<string>> {
  const busca = filtro.busca.trim() || undefined;

  const [itensLista, itensArquivados] = await Promise.all([
    buscarPaginas("/api/oportunidades/lista", {
      busca,
      responsavelId: filtro.responsavelId,
      origem: filtro.origem,
    }),
    buscarPaginas("/api/oportunidades/arquivados", {
      busca,
      responsavelId: filtro.responsavelId,
    }),
  ]);

  const ids = new Set<string>();
  for (const item of itensLista) ids.add(item.id);
  for (const item of itensArquivados) {
    if (filtro.origem && item.origem !== filtro.origem) continue;
    ids.add(item.id);
  }
  return ids;
}

export function BoardKanban() {
  const [itensBrutos, setItensBrutos] = useState<CardBoard[]>([]);
  const [grafo, setGrafo] = useState<Record<number, number[]>>({});
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [cardAtivo, setCardAtivo] = useState<CardBoard | null>(null);
  const [dadoFaltante, setDadoFaltante] = useState<DadoFaltantePendente | null>(null);
  const [oportunidadesAtrasadas, setOportunidadesAtrasadas] = useState<Set<string>>(new Set());
  const [proximasAcoes, setProximasAcoes] = useState<Map<string, string | null>>(new Map());

  // AC-390.
  const [filtro, setFiltro] = useState<ValorFiltrosFunil>({ busca: "" });
  const [idsPermitidos, setIdsPermitidos] = useState<Set<string> | null>(null);
  const [opcoes, setOpcoes] = useState<{ responsaveis: OpcaoResponsavelFunil[]; origens: string[] }>({
    responsaveis: [],
    origens: [],
  });

  // AC-389.
  const [indicadores, setIndicadores] = useState<IndicadoresFunilView | null>(null);

  // AC-391/AC-392.
  const [modalNovoLeadAberto, setModalNovoLeadAberto] = useState(false);
  // T-296 (AC-759/AC-760): "Iniciar Cadência em Massa" — todos os cards da Entrada de leads que o filtro deixa à vista.
  const [cadenciaEmMassaAberta, setCadenciaEmMassaAberta] = useState(false);
  const [iniciandoCadencia, setIniciandoCadencia] = useState(false);
  const [erroDaCadenciaEmMassa, setErroDaCadenciaEmMassa] = useState<string | null>(null);
  const [resultadoDaCadenciaEmMassa, setResultadoDaCadenciaEmMassa] = useState<{ lote: ResultadoDoLoteView; nomes: Record<string, string> } | null>(null);

  const itens = useMemo<CardBoard[]>(() => {
    const comProximaAcao = itensBrutos.map((item) => ({
      ...item,
      proximaAcaoEm: proximasAcoes.has(item.id) ? proximasAcoes.get(item.id) ?? null : item.proximaAcaoEm ?? null,
    }));
    return idsPermitidos ? comProximaAcao.filter((item) => idsPermitidos.has(item.id)) : comProximaAcao;
  }, [itensBrutos, idsPermitidos, proximasAcoes]);

  const cardsDaEntrada = useMemo(() => itens.filter((item) => item.etapaId === ETAPA_ENTRADA_DE_LEADS), [itens]);

  const carregarBoard = useCallback(async () => {
    setErroCarga(null);
    try {
      const resposta = await fetch("/api/oportunidades");
      if (!resposta.ok) throw new Error(`board respondeu ${resposta.status}`);
      const corpo = await resposta.json();
      setItensBrutos(corpo.itens ?? []);
      setGrafo(corpo.grafo ?? {});
    } catch {
      setErroCarga("Não foi possível carregar o board. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarBoard();
  }, [carregarBoard]);

  // AC-220/AC-388: cruza o board com `?atrasados=1` (T-095) pra saber quais
  // cards mostram o selo "Atrasado" e, quando a fila trouxer o campo, a hora
  // da próxima ação de cada um (card sem toque pendente mostra "Sem próxima
  // ação" — `card-oportunidade.tsx`).
  const carregarAtrasados = useCallback(async () => {
    try {
      const resposta = await fetch("/api/atividades?atrasados=1");
      if (!resposta.ok) return;
      const corpo = await resposta.json();
      const itensFila = (corpo.itens ?? []) as {
        oportunidade: { id: string; proximaAcaoEm?: string | null };
        atrasado: boolean;
      }[];
      setOportunidadesAtrasadas(
        new Set(itensFila.filter((item) => item.atrasado).map((item) => item.oportunidade.id))
      );
      setProximasAcoes(new Map(itensFila.map((item) => [item.oportunidade.id, item.oportunidade.proximaAcaoEm ?? null])));
    } catch {
      // Sem conectividade: mantém o selo como estava até a próxima tentativa.
    }
  }, []);

  useEffect(() => {
    carregarAtrasados();
  }, [carregarAtrasados]);

  // AC-389: indicadores do topo — independentes do board (uma falha aqui não bloqueia o quadro).
  const carregarIndicadores = useCallback(async () => {
    try {
      const resposta = await fetch("/api/pipeline/indicadores?visao=funil");
      if (!resposta.ok) return;
      setIndicadores(await resposta.json());
    } catch {
      // mantém o que já tinha carregado.
    }
  }, []);

  useEffect(() => {
    carregarIndicadores();
  }, [carregarIndicadores]);

  // AC-390/AC-391/ASM-137: opções de responsável/origem a partir dos valores
  // que já existem na empresa — mesma amostra sem lista oficial de
  // `pipeline/lista/page.tsx` (T-161).
  useEffect(() => {
    let cancelado = false;
    fetch("/api/oportunidades/lista?porPagina=50")
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo: { itens?: { responsavel?: { id: string; nome: string } | null; lead?: { origem?: string | null } }[] } | null) => {
        if (cancelado || !corpo) return;
        const responsaveis = new Map<string, string>();
        const origens = new Set<string>();
        for (const item of corpo.itens ?? []) {
          if (item.responsavel) responsaveis.set(item.responsavel.id, item.responsavel.nome);
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

  // AC-390: recalcula o conjunto de ids permitidos sempre que o filtro muda;
  // sem nenhum filtro ativo, mostra o quadro inteiro sem chamada extra.
  useEffect(() => {
    if (!filtroFunilAtivo(filtro)) {
      setIdsPermitidos(null);
      return;
    }
    let cancelado = false;
    buscarIdsPermitidos(filtro)
      .then((ids) => {
        if (!cancelado) setIdsPermitidos(ids);
      })
      .catch(() => {
        if (!cancelado) setIdsPermitidos(new Set());
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro.busca, filtro.responsavelId, filtro.origem]);

  // T-065 (fase2c-sse, US-037): ref com o estado atual pra checar, no
  // momento em que o evento chega, se o card aparece no board — sem recriar
  // o EventSource a cada atualização de `itens` (useStreamOportunidades só
  // reabre a conexão se a identidade do callback mudar). AC-112: aponta pro
  // conjunto já filtrado (AC-390) — card fora do filtro é "fora do board"
  // igual a card fora do filtro antigo de etapa/responsável.
  const itensRef = useRef(itens);
  itensRef.current = itens;

  const aplicarEventoMovido = useCallback(
    async (evento: EventoOportunidadeMovidaCliente) => {
      // AC-112: card que o board não mostra (fora do board ou fora do
      // filtro, AC-390) é ignorado sem nenhuma chamada extra.
      if (!itensRef.current.some((item) => item.id === evento.oportunidadeId)) return;

      const resposta = await fetch(`/api/oportunidades/${evento.oportunidadeId}`);
      if (!resposta.ok) return;
      const card = await resposta.json();

      setItensBrutos((atual) =>
        atual.map((item) => {
          if (item.id !== card.id) return item;
          // Q-010: o próprio ator já recebeu essa versão via `carregarBoard`
          // depois da transição — não há o que reposicionar.
          if (card.version <= item.version) return item;
          return {
            ...item,
            etapaId: card.etapaId,
            responsavelId: card.responsavelId,
            responsavelNome: card.responsavelNome,
            valor: card.valor,
            version: card.version,
          };
        })
      );
      void carregarIndicadores();
    },
    [carregarIndicadores]
  );

  const aoReceberEventoStream = useCallback(
    (evento: EventoStreamCliente) => {
      if (evento.tipo === "stream.reconectado") {
        void carregarBoard();
        void carregarAtrasados();
        void carregarIndicadores();
        return;
      }
      // AC-220: o selo some sem recarregar a página — qualquer alteração na
      // fila (concluir o toque, por exemplo) refaz só o conjunto de atrasados.
      if (evento.tipo === "cadencia.fila_alterada") {
        void carregarAtrasados();
        return;
      }
      if (evento.tipo !== "oportunidade.movida") return;
      void aplicarEventoMovido(evento);
    },
    [carregarBoard, carregarAtrasados, carregarIndicadores, aplicarEventoMovido]
  );

  const aoPolling = useCallback(() => {
    void carregarBoard();
    void carregarAtrasados();
  }, [carregarBoard, carregarAtrasados]);

  // AC-416: só expõe o estado da conexão pro aviso "tempo real desconectado"
  // (`AvisoTempoReal`) — a reconciliação em si já roda pelos callbacks acima.
  const { estadoConexao } = useStreamOportunidades({ aoReceberEvento: aoReceberEventoStream, aoPolling });

  useEffect(() => {
    if (!mensagem) return;
    const timeout = setTimeout(() => setMensagem(null), 5000);
    return () => clearTimeout(timeout);
  }, [mensagem]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragStart = (event: DragStartEvent) => {
    const card = itens.find((item) => item.id === event.active.id);
    setCardAtivo(card ?? null);
  };

  const handleDragCancel = () => setCardAtivo(null);

  const enviarTransicao = useCallback(
    async (oportunidadeId: string, corpo: Record<string, unknown>) => {
      const resposta = await fetch(`/api/oportunidades/${oportunidadeId}/transicao`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });

      if (resposta.ok) {
        await carregarBoard();
        void carregarIndicadores();
        setMensagem(null);
        setDadoFaltante(null);
        return;
      }

      const erro = await resposta.json().catch(() => null);
      const codigo = erro?.codigo as CodigoErroTransicao | undefined;
      if (!codigo) {
        setMensagem("Não foi possível mover o card. Tente de novo.");
        return;
      }

      // AC-088: dado faltante abre o modal correspondente. AC-091: grafo/papel
      // só mostram mensagem — o card nunca chega a mudar de coluna, porque
      // `itens` só é atualizado depois de uma resposta OK (nenhum "reverter"
      // é necessário).
      if (exigeDadoFaltante(codigo)) {
        const version = typeof corpo.version === "number" ? corpo.version : 0;
        const etapaDestinoId = typeof corpo.etapaDestinoId === "number" ? corpo.etapaDestinoId : 0;
        setDadoFaltante({ oportunidadeId, etapaDestinoId, version, codigo });
      } else {
        setMensagem(MENSAGENS_ERRO[codigo] ?? "Não foi possível mover o card.");
      }
    },
    [carregarBoard, carregarIndicadores]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setCardAtivo(null);
    const { active, over } = event;
    if (!over) return;

    const card = itens.find((item) => item.id === active.id);
    if (!card) return;

    const etapaDestinoId = Number(over.id);
    if (etapaDestinoId === card.etapaId) return;

    const alcancaveis = grafo[card.etapaId] ?? [];
    if (!alcancaveis.includes(etapaDestinoId)) return; // AC-094: coluna nem deveria estar droppable.

    enviarTransicao(card.id, { version: card.version, etapaDestinoId });
  };

  const alcancaveisDoAtivo = cardAtivo ? new Set(grafo[cardAtivo.etapaId] ?? []) : null;

  // AC-391/AC-392: cria o card e, só quando pedido, já inicia a cadência.
  const aoCriarLead = useCallback(
    async (dados: DadosNovoLead): Promise<ResultadoSalvarNovoLead> => {
      const resultado = await criarCardNovoLead(dados);
      if (!resultado.ok) return { ok: false, erro: resultado.erro, campo: resultado.campo };
      await carregarBoard();
      void carregarIndicadores();
      return { ok: true };
    },
    [carregarBoard, carregarIndicadores]
  );

  const aoCriarLeadEIniciarCadencia = useCallback(
    async (dados: DadosNovoLead): Promise<ResultadoSalvarNovoLead> => {
      const resultado = await criarLeadEIniciarCadencia(dados);
      if (!resultado.ok) return { ok: false, erro: resultado.erro, campo: resultado.campo };
      await carregarBoard();
      void carregarIndicadores();
      return { ok: true };
    },
    [carregarBoard, carregarIndicadores]
  );

  async function iniciarCadenciaEmMassaDaEntrada() {
    const nomes: Record<string, string> = {};
    for (const item of cardsDaEntrada) nomes[item.id] = item.leadNome;
    setIniciandoCadencia(true);
    setErroDaCadenciaEmMassa(null);
    try {
      const lote = await iniciarCadenciaEmMassa(cardsDaEntrada.map((item) => item.id));
      setCadenciaEmMassaAberta(false);
      setResultadoDaCadenciaEmMassa({ lote, nomes });
      await carregarBoard();
      void carregarIndicadores();
    } catch (erro) {
      setErroDaCadenciaEmMassa(MENSAGEM_DO_PEDIDO[erro instanceof Error ? erro.message : ""] ?? "Não foi possível iniciar a cadência. Tente de novo.");
    } finally {
      setIniciandoCadencia(false);
    }
  }

  return (
    // AC-733: o quadro ocupa a altura da tela (tela menos o topo de 4rem) e quem rola é cada coluna, não a página
    <div className="flex flex-col gap-space-md p-space-md h-[calc(100dvh-4rem)] min-h-[40rem]">
      <div className="flex items-center justify-between flex-wrap gap-space-sm">
        <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Funil Pipeline de Vendas</h1>
        <div className="flex items-center gap-space-sm">
          <button
            type="button"
            disabled={cardsDaEntrada.length === 0}
            title={cardsDaEntrada.length === 0 ? "Não há cards em Entrada de leads" : undefined}
            onClick={() => {
              setErroDaCadenciaEmMassa(null);
              setCadenciaEmMassaAberta(true);
            }}
            className="h-10 px-4 rounded-xl bg-surface-card hover:bg-surface-subtle shadow-sm flex items-center gap-2 font-label-md text-label-md font-semibold text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[19px]">
              schedule_send
            </span>
            Iniciar Cadência em Massa
          </button>
          <button
            type="button"
            onClick={() => setModalNovoLeadAberto(true)}
            className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-2 transition-all"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[19px]">
              add
            </span>
            Novo Lead
          </button>
        </div>
      </div>

      <AvisoTempoReal estadoConexao={estadoConexao} />

      {resultadoDaCadenciaEmMassa && (
        <ResultadoLote
          acao="cadencia"
          lote={resultadoDaCadenciaEmMassa.lote}
          nomes={resultadoDaCadenciaEmMassa.nomes}
          onFechar={() => setResultadoDaCadenciaEmMassa(null)}
        />
      )}

      {cadenciaEmMassaAberta && (
        <DialogoIniciarCadencia
          quantidade={cardsDaEntrada.length}
          enviando={iniciandoCadencia}
          erro={erroDaCadenciaEmMassa}
          onConfirmar={() => void iniciarCadenciaEmMassaDaEntrada()}
          onFechar={() => setCadenciaEmMassaAberta(false)}
        />
      )}

      {indicadores ? <IndicadoresFunil dados={indicadores} /> : <EsqueletoCarregando linhas={1} />}

      <FiltrosFunil
        valor={filtro}
        responsaveis={opcoes.responsaveis}
        origens={opcoes.origens}
        onMudar={(patch) => setFiltro((atual) => ({ ...atual, ...patch }))}
        onLimpar={() => setFiltro({ busca: "" })}
      />

      {mensagem && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {mensagem}
        </div>
      )}

      {carregando && <EsqueletoCarregando />}
      {!carregando && erroCarga && <EstadoErro mensagem={erroCarga} onTentarDeNovo={carregarBoard} />}
      {!carregando && !erroCarga && itensBrutos.length === 0 && (
        <EstadoVazio titulo="Nenhum lead ainda" proximoPasso="crie o primeiro em “Novo Lead”" icone="group_work" />
      )}

      {!carregando && !erroCarga && itensBrutos.length > 0 && (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
          <div className="flex-1 min-h-0 flex w-full overflow-x-auto items-stretch gap-4 pb-2">
            {ETAPAS.map((etapa) => (
              <ColunaEtapa
                key={etapa.id}
                etapaId={etapa.id}
                nome={etapa.nome}
                cards={itens.filter((item) => item.etapaId === etapa.id)}
                podeReceberDrop={cardAtivo ? (alcancaveisDoAtivo?.has(etapa.id) ?? false) : true}
                arrastando={cardAtivo !== null}
                oportunidadesAtrasadas={oportunidadesAtrasadas}
              />
            ))}
          </div>

          <DragOverlay>{cardAtivo ? <CardOportunidade oportunidade={cardAtivo} isOverlay /> : null}</DragOverlay>
        </DndContext>
      )}

      {dadoFaltante && (
        <ModalDadoFaltante
          codigo={dadoFaltante.codigo}
          oportunidadeId={dadoFaltante.oportunidadeId}
          aberto
          onCancelar={() => setDadoFaltante(null)}
          onConfirmar={(dado) =>
            enviarTransicao(dadoFaltante.oportunidadeId, {
              version: dadoFaltante.version,
              etapaDestinoId: dadoFaltante.etapaDestinoId,
              ...dado,
            })
          }
        />
      )}

      <ModalNovoLead
        aberto={modalNovoLeadAberto}
        origens={opcoes.origens}
        responsaveis={opcoes.responsaveis}
        onFechar={() => setModalNovoLeadAberto(false)}
        onCriar={aoCriarLead}
        onCriarEIniciarCadencia={aoCriarLeadEIniciarCadencia}
      />
    </div>
  );
}
