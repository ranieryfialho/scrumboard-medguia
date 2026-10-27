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
import { Informacoes, type TelefoneInformacao } from '@/components/pipeline/detalhe/informacoes';
import { LinhaDoTempo } from '@/components/pipeline/detalhe/linha-do-tempo';
import { RegistroRapido } from '@/components/pipeline/detalhe/registro-rapido';

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

const ABAS = [
  { chave: 'resumo', rotulo: 'Resumo', icone: 'dashboard', segmento: null },
  { chave: 'cadencia', rotulo: 'Cadência', icone: 'checklist', segmento: 'cadencia' },
  { chave: 'whatsapp', rotulo: 'WhatsApp', icone: 'chat', segmento: 'conversa' },
  { chave: 'anexos', rotulo: 'Anexos & Evidências', icone: 'attachment', segmento: 'anexos' },
] as const;

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

      {/* AC-411: Resumo ativa; as outras levam às rotas atuais (telas 10 a 12 virão depois). */}
      <div className="px-gutter pb-space-sm bg-surface-card shadow-sm flex items-center gap-1 overflow-x-auto">
        {ABAS.map((aba) =>
          aba.segmento === null ? (
            <span
              key={aba.chave}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-label-lg text-label-lg text-primary bg-primary-fixed/40"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                {aba.icone}
              </span>
              {aba.rotulo}
            </span>
          ) : (
            <Link
              key={aba.chave}
              href={`/pipeline/${dados.id}/${aba.segmento}`}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-label-lg text-label-lg text-text-secondary hover:text-text-primary hover:bg-surface-subtle transition-colors"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                {aba.icone}
              </span>
              {aba.rotulo}
            </Link>
          )
        )}
      </div>

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
            />
          </div>

          <div className="lg:col-span-8 flex flex-col gap-space-lg">
            <RegistroRapido oportunidadeId={dados.id} onRegistrado={() => setVersaoLinhaDoTempo((versao) => versao + 1)} />
            <LinhaDoTempo oportunidadeId={dados.id} versao={versaoLinhaDoTempo} />
          </div>
        </div>
      </div>

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
