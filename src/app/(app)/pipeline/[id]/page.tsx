'use client';

// T-163 (fase4-pipeline-telas, US-109): tela de detalhe do card — fonte
// visual `docs/ui/stitch_medcrm_interface_design/9._pipeline_id_detalhe_do_card/`.
// Vive no grupo `(app)` (`src/app/(app)/layout.tsx`, T-146); substitui
// `src/app/pipeline/[id]/page.tsx` (apagado nesta tarefa — mesma URL
// `/pipeline/[id]`, não dá pra ter as duas rotas ao mesmo tempo). Orquestra
// os cinco componentes de `components/pipeline/detalhe/`: `CabecalhoCard`
// (AC-406), `Jornada` (AC-406), `Informacoes` (AC-407), `RegistroRapido`
// (AC-409) e `LinhaDoTempo` (AC-408). "Mover de Etapa"/"Marcar como
// Ganho"/"Perdido" (AC-410) reusam `POST /api/oportunidades/:id/transicao` e
// o `ModalDadoFaltante` já existentes (fase2-kanban) — mesmo padrão de
// `board-kanban.tsx`. O grafo de destinos alcançáveis pelo papel vem de
// `GET /api/oportunidades?etapaId=` (T-046/AC-094, já filtrado por papel),
// sem endpoint novo. `BotaoIniciarCadencia` (fase2b, AC-214/215/216) segue
// embarcado aqui por compatibilidade — não está nas ACs desta feature, mas
// `test/components/pipeline/iniciar-cadencia.test.tsx` prova esse
// comportamento contra esta mesma página, e apagar a função teria apagado a
// prova de um critério de outra feature, o que a constituição proíbe.
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import type { CodigoErroTransicao } from '@/domain/pipeline/tipos';
import { exigeDadoFaltante } from '@/domain/pipeline/classificar-erro-transicao';
import { ModalDadoFaltante, type DadoPreenchido } from '@/components/pipeline/modal-dado-faltante';
import { BotaoIniciarCadencia } from '@/components/pipeline/botao-iniciar-cadencia';
import { EsqueletoCarregando, EstadoErro } from '@/components/pipeline/pecas/estados';
import { CabecalhoCard, type EtapaOpcao } from '@/components/pipeline/detalhe/cabecalho-card';
import { Jornada, nomeDaEtapa } from '@/components/pipeline/detalhe/jornada';
import { ConsentimentoWhatsapp } from '@/components/pipeline/detalhe/consentimento-whatsapp';
import { Informacoes, type TelefoneInformacao } from '@/components/pipeline/detalhe/informacoes';
import { LinhaDoTempo } from '@/components/pipeline/detalhe/linha-do-tempo';
import { ModalEditarCard, type ResultadoEdicaoCard, type ValoresEdicaoCard } from '@/components/pipeline/detalhe/modal-editar-card';
import { RegistroRapido } from '@/components/pipeline/detalhe/registro-rapido';
import { AbasDoCard } from '@/components/pipeline/card/abas-do-card';
import { useContadoresDoCard } from '@/components/pipeline/card/use-contadores-do-card';

const ETAPA_PERDIDO = 14;
const ETAPA_CONTRATO_GANHO = 15;

const MENSAGENS_ERRO: Partial<Record<CodigoErroTransicao, string>> = {
  TRANSICAO_NAO_PERMITIDA: 'Essa etapa não pode ser alcançada a partir da etapa atual.',
  PAPEL_NAO_PERMITIDO: 'Seu papel não tem permissão para fazer essa transição.',
};

interface DetalheOportunidade {
  id: string;
  leadId: string;
  etapaId: number;
  leadNome: string;
  origem: string | null;
  email: string | null;
  telefoneE164: string | null;
  criadoEm: string;
  responsavelId: string | null;
  responsavelNome: string | null;
  valor: string | null;
  proximaAcaoEm: string | null;
  version: number;
}

interface DadoFaltantePendente {
  etapaDestinoId: number;
  codigo: CodigoErroTransicao;
}

function PipelineDetalheConteudo({ id }: { id: string }) {
  const [dados, setDados] = useState<DetalheOportunidade | null>(null);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);

  const [telefones, setTelefones] = useState<TelefoneInformacao[]>([]);
  const [etapasDestino, setEtapasDestino] = useState<EtapaOpcao[]>([]);
  const [podeMarcarGanho, setPodeMarcarGanho] = useState(false);
  const [podeMarcarPerdido, setPodeMarcarPerdido] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [dadoFaltante, setDadoFaltante] = useState<DadoFaltantePendente | null>(null);
  const [versaoLinhaDoTempo, setVersaoLinhaDoTempo] = useState(0);
  const [editando, setEditando] = useState(false);

  /** T-287 (AC-736): salva a edição, recarrega o card e o log da linha do tempo; devolve o erro do servidor ao modal. */
  async function salvarEdicao(valores: ValoresEdicaoCard): Promise<ResultadoEdicaoCard> {
    try {
      const resposta = await fetch(`/api/oportunidades/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nome: valores.nome,
          email: valores.email,
          origem: valores.origem,
          telefone: valores.telefone,
          valor: valores.valor.trim() === '' ? null : valores.valor,
        }),
      });
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => null)) as { codigo?: string; campo?: keyof ValoresEdicaoCard } | null;
        const mensagens: Record<string, string> = {
          TELEFONE_DUPLICADO: 'Esse telefone já pertence a outro lead.',
          VALOR_OBRIGATORIO_NA_PROPOSTA: 'Na etapa Proposta o valor estimado é obrigatório.',
          CAMPO_INVALIDO: 'Confira esse campo.',
        };
        return { ok: false, erro: mensagens[corpo?.codigo ?? ''] ?? 'Não foi possível salvar. Tente de novo.', campo: corpo?.campo };
      }
      const novo = await fetch(`/api/oportunidades/${id}`);
      if (novo.ok) {
        const corpoNovo = (await novo.json()) as DetalheOportunidade;
        setDados(corpoNovo);
        await carregarTelefones(corpoNovo.leadId);
      }
      setVersaoLinhaDoTempo((versao) => versao + 1);
      setEditando(false);
      return { ok: true };
    } catch {
      return { ok: false, erro: 'Sem conexão. Tente de novo.' };
    }
  }

  // T-171 (AC-420): contadores das abas (toques de 18 e anexos); falha só omite o número.
  const contagens = useContadoresDoCard(dados ? id : null);

  const [cadenciaIniciada, setCadenciaIniciada] = useState(false);
  const [erroCadencia, setErroCadencia] = useState<string | null>(null);

  // AC-410: destinos alcançáveis pelo papel — mesmo `grafo` que o board já
  // calcula (T-046, filtrado por `papelPodeTransicionar`); isolado num
  // try/catch próprio para uma falha aqui nunca derrubar a tela inteira.
  const carregarGrafo = useCallback(async (etapaAtualId: number) => {
    try {
      const resposta = await fetch(`/api/oportunidades?etapaId=${etapaAtualId}`);
      if (!resposta.ok) return;
      const corpo = await resposta.json();
      const alcancaveis: number[] = corpo?.grafo?.[etapaAtualId] ?? [];
      setEtapasDestino(
        alcancaveis
          .filter((destinoId) => destinoId !== ETAPA_PERDIDO && destinoId !== ETAPA_CONTRATO_GANHO)
          .map((destinoId) => ({ id: destinoId, nome: nomeDaEtapa(destinoId) }))
      );
      setPodeMarcarGanho(alcancaveis.includes(ETAPA_CONTRATO_GANHO));
      setPodeMarcarPerdido(alcancaveis.includes(ETAPA_PERDIDO));
    } catch {
      // Sem conectividade: mantém as ações como estavam até a próxima tentativa.
    }
  }, []);

  // T-157: telefones do lead vêm de `GET /api/leads/:id/telefones`
  // (reaproveitado, sem rota nova) — também isolado, pelo mesmo motivo.
  const carregarTelefones = useCallback(async (leadId: string) => {
    try {
      const resposta = await fetch(`/api/leads/${leadId}/telefones`);
      if (!resposta.ok) return;
      const corpo = await resposta.json();
      setTelefones(corpo?.telefones ?? []);
    } catch {
      // Sem conectividade: mantém a lista como estava até a próxima tentativa.
    }
  }, []);

  const carregarCard = useCallback(async () => {
    setErro(false);
    setCarregando(true);
    try {
      const resposta = await fetch(`/api/oportunidades/${id}`);
      if (resposta.status === 404) {
        setNaoEncontrado(true);
        return;
      }
      if (!resposta.ok) throw new Error(`detalhe respondeu ${resposta.status}`);
      const corpo = (await resposta.json()) as DetalheOportunidade;
      setDados(corpo);
      await Promise.all([carregarGrafo(corpo.etapaId), carregarTelefones(corpo.leadId)]);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [id, carregarGrafo, carregarTelefones]);

  useEffect(() => {
    carregarCard();
  }, [carregarCard]);

  // AC-216 (fase2b, preservado): em erro ao iniciar cadência, resincroniza
  // etapa/version sem reativar o esqueleto de carregamento da tela inteira.
  const resincronizarCard = useCallback(async () => {
    try {
      const resposta = await fetch(`/api/oportunidades/${id}`);
      if (resposta.status === 404) {
        setNaoEncontrado(true);
        return;
      }
      if (!resposta.ok) return;
      setDados((await resposta.json()) as DetalheOportunidade);
    } catch {
      // Sem conectividade: mantém os dados locais, a mensagem de erro já foi mostrada.
    }
  }, [id]);

  // AC-410: move de etapa / marca como ganho / perdido — mesma rota e o
  // mesmo modal de dado faltante que o board já usa (T-047/T-050).
  const enviarTransicao = useCallback(
    async (etapaDestinoId: number, dadoExtra: DadoPreenchido = {}) => {
      if (!dados) return;
      setEnviando(true);
      setMensagem(null);
      try {
        const resposta = await fetch(`/api/oportunidades/${dados.id}/transicao`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version: dados.version, etapaDestinoId, ...dadoExtra }),
        });

        if (resposta.ok) {
          const movida = await resposta.json();
          setDados((atual) => (atual ? { ...atual, etapaId: movida.etapaId, version: movida.version } : atual));
          setDadoFaltante(null);
          setVersaoLinhaDoTempo((versao) => versao + 1);
          await carregarGrafo(movida.etapaId);
          return;
        }

        const corpoErro = await resposta.json().catch(() => null);
        const codigo = corpoErro?.codigo as CodigoErroTransicao | undefined;
        if (codigo && exigeDadoFaltante(codigo)) {
          setDadoFaltante({ etapaDestinoId, codigo });
        } else {
          setMensagem(codigo ? (MENSAGENS_ERRO[codigo] ?? 'Não foi possível mover o card.') : 'Não foi possível mover o card.');
        }
      } finally {
        setEnviando(false);
      }
    },
    [dados, carregarGrafo]
  );

  if (carregando) {
    return (
      <div className="p-space-md">
        <EsqueletoCarregando />
      </div>
    );
  }

  if (erro) {
    return (
      <div className="p-space-md">
        <EstadoErro onTentarDeNovo={carregarCard} />
      </div>
    );
  }

  // AC-412: id inexistente ou de outra empresa — mesma mensagem nos dois
  // casos, sem distinguir qual é, e caminho de volta ao funil.
  if (naoEncontrado || !dados) {
    return (
      <div className="p-space-2xl flex flex-col items-center justify-center text-center gap-3">
        <span aria-hidden="true" className="material-symbols-outlined text-text-muted text-[40px]">
          search_off
        </span>
        <p className="font-headline-sm text-headline-sm text-text-primary">Card não encontrado</p>
        <Link href="/pipeline" className="font-label-lg text-label-lg text-primary hover:underline">
          Voltar ao funil
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full">
      <CabecalhoCard
        leadNome={dados.leadNome}
        etapaAtualNome={nomeDaEtapa(dados.etapaId)}
        responsavelNome={dados.responsavelNome}
        etapasDestino={etapasDestino}
        podeMarcarGanho={podeMarcarGanho}
        podeMarcarPerdido={podeMarcarPerdido}
        enviando={enviando}
        onEscolherDestino={(etapaDestinoId) => enviarTransicao(etapaDestinoId)}
      />

      <AbasDoCard cardId={dados.id} ativa="resumo" contagens={contagens} />

      <Jornada etapaAtualId={dados.etapaId} />

      {mensagem && (
        <div className="mx-gutter mt-space-sm text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {mensagem}
        </div>
      )}

      <div className="px-gutter pt-space-sm flex flex-col gap-1">
        <BotaoIniciarCadencia
          oportunidadeId={dados.id}
          etapaId={dados.etapaId}
          version={dados.version}
          onIniciado={(resultado) => {
            setDados((atual) => (atual ? { ...atual, etapaId: resultado.etapaId, version: resultado.version } : atual));
            setCadenciaIniciada(true);
            setErroCadencia(null);
          }}
          onErro={(mensagemErro) => {
            setErroCadencia(mensagemErro);
            void resincronizarCard();
          }}
        />
        {cadenciaIniciada && (
          <p className="font-body-sm text-body-sm text-success-text">
            Cadência iniciada — os 3 primeiros toques estão em Minhas tarefas.
          </p>
        )}
        {erroCadencia && <p className="font-body-sm text-body-sm text-danger-text">{erroCadencia}</p>}
      </div>

      <div className="p-gutter w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
          <div className="lg:col-span-4 flex flex-col gap-space-lg">
            <Informacoes
              valor={dados.valor}
              origem={dados.origem}
              criadoEm={dados.criadoEm}
              responsavelNome={dados.responsavelNome}
              proximaAcaoEm={dados.proximaAcaoEm}
              telefones={telefones}
              email={dados.email}
              onEditar={() => setEditando(true)}
            />
            <ConsentimentoWhatsapp leadId={dados.leadId} />
          </div>

          <div className="lg:col-span-8 flex flex-col gap-space-lg">
            <RegistroRapido oportunidadeId={dados.id} onRegistrado={() => setVersaoLinhaDoTempo((versao) => versao + 1)} />
            <LinhaDoTempo oportunidadeId={dados.id} versao={versaoLinhaDoTempo} />
          </div>
        </div>
      </div>

      {editando && (
        <ModalEditarCard
          inicial={{
            nome: dados.leadNome,
            email: dados.email ?? '',
            origem: dados.origem ?? '',
            telefone: dados.telefoneE164 ?? '',
            valor: dados.valor ? String(Number(dados.valor)) : '',
          }}
          onFechar={() => setEditando(false)}
          onSalvar={salvarEdicao}
        />
      )}

      {dadoFaltante && (
        <ModalDadoFaltante
          codigo={dadoFaltante.codigo}
          aberto
          oportunidadeId={dados.id}
          onCancelar={() => setDadoFaltante(null)}
          onConfirmar={(dado) => enviarTransicao(dadoFaltante.etapaDestinoId, dado)}
        />
      )}
    </div>
  );
}

export default function PipelineDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PipelineDetalheConteudo id={id} />;
}
