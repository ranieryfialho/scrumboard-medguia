'use client';

// T-173 (fase4-card-abas, US-113): tela da cadência de 18 toques do card — fonte
// visual `docs/ui/stitch_medcrm_interface_design/10._pipeline_id_cadencia_cad_ncia_do_card/`.
// Vive no grupo `(app)` e dentro do `MoldeDoCard` (T-171). Os toques vêm de
// `GET /api/oportunidades/[id]/cadencia` (T-170); concluir o toque da vez usa
// `POST /api/atividades/[id]/concluir` (a mesma API da fila do turno). Pausar,
// reiniciar a régua e demais ações sem backend ficam "em breve" (AC-436); script,
// taxa de engajamento e SLA do protótipo não aparecem (sem dado).
import { use, useCallback, useEffect, useState } from 'react';

import { BotaoIniciarCadencia } from '@/components/pipeline/botao-iniciar-cadencia';
import { MoldeDoCard } from '@/components/pipeline/card/molde-do-card';
import { nomeDaEtapa } from '@/components/pipeline/detalhe/jornada';
import { HistoricoToques } from '@/components/pipeline/cadencia/historico-toques';
import { MatrizToques } from '@/components/pipeline/cadencia/matriz-toques';
import { ResumoCadencia } from '@/components/pipeline/cadencia/resumo-cadencia';
import { ToqueDaVez } from '@/components/pipeline/cadencia/toque-da-vez';
import type { CadenciaDoCardView } from '@/components/pipeline/cadencia/tipos';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from '@/components/pipeline/pecas/estados';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';

/** Só card em "Entrada de leads" inicia a cadência (a mesma regra do botão no funil). */
const ETAPA_ENTRADA_DE_LEADS = 1;

/** AC-434: mensagem de cada recusa da API de concluir o toque. */
const MENSAGENS_DE_ERRO: Record<string, string> = {
  TURNO_NAO_LIBERADO: 'Este toque ainda não foi liberado: aguarde o início do turno.',
  BLOCO_ANTERIOR_PENDENTE: 'Conclua primeiro os toques do bloco anterior.',
  CADENCIA_ENCERRADA: 'A cadência deste card já foi encerrada.',
  CONFLITO_DE_VERSAO: 'Outra pessoa mexeu neste card antes de você. A tela foi atualizada, tente de novo.',
  SEM_PERMISSAO: 'Você não tem permissão para concluir este toque.',
  TOQUE_NAO_ACEITA_AGUARDAR: 'Só toques de WhatsApp podem ficar aguardando resposta.',
};

function ConteudoCadencia({ cardId, onMudou }: { cardId: string; onMudou: () => void }) {
  const [cadencia, setCadencia] = useState<CadenciaDoCardView | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [concluindo, setConcluindo] = useState(false);
  const [erroDeConclusao, setErroDeConclusao] = useState<string | null>(null);
  const [erroDeInicio, setErroDeInicio] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(false);
    try {
      const resposta = await fetch(`/api/oportunidades/${cardId}/cadencia`);
      if (!resposta.ok) throw new Error(`cadência respondeu ${resposta.status}`);
      setCadencia((await resposta.json()) as CadenciaDoCardView);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [cardId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function concluir(resultado: 'conectou' | 'sem_resposta') {
    const vez = cadencia?.toqueDaVez;
    if (!cadencia || !vez?.atividadeId) return;
    setConcluindo(true);
    setErroDeConclusao(null);
    try {
      const resposta = await fetch(`/api/atividades/${vez.atividadeId}/concluir`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: cadencia.oportunidade.version, resultado }),
      });
      if (resposta.ok) {
        await carregar();
        onMudou();
        return;
      }
      const corpo = (await resposta.json().catch(() => null)) as { codigo?: string } | null;
      setErroDeConclusao(MENSAGENS_DE_ERRO[corpo?.codigo ?? ''] ?? 'Não foi possível concluir o toque. Tente de novo.');
      if (corpo?.codigo === 'CONFLITO_DE_VERSAO') await carregar();
    } catch {
      setErroDeConclusao('Não foi possível concluir o toque. Tente de novo.');
    } finally {
      setConcluindo(false);
    }
  }

  return (
    <div className="p-gutter flex flex-col gap-space-md w-full lg:flex-1 lg:min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <div>
          <h2 className="font-headline-md text-headline-md text-text-primary">Cadência de 18 Toques</h2>
          <p className="font-body-sm text-body-sm text-text-secondary">Régua de relacionamento deste card, toque a toque.</p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <ItemEmBreve rotulo="Pausar Cadência" icone="pause_circle" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm" />
          <ItemEmBreve rotulo="Reiniciar Régua" icone="restart_alt" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm" />
        </div>
      </div>

      {/* AC-749: o título fica parado; o resumo, o toque da vez e as listas rolam por dentro. */}
      <div className="relative flex flex-col gap-space-md lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
        {carregando && <EsqueletoCarregando />}
        {!carregando && erro && <EstadoErro onTentarDeNovo={carregar} />}

        {!carregando && !erro && cadencia && !cadencia.iniciada && (
          <div className="flex flex-col items-center gap-space-md">
            <EstadoVazio
              titulo="A cadência deste card ainda não foi iniciada"
              proximoPasso={
                cadencia.oportunidade.etapaId === ETAPA_ENTRADA_DE_LEADS
                  ? 'inicie a régua de 18 toques pelo botão abaixo'
                  : `a cadência só começa em card na etapa “Entrada de leads”; este card está em “${nomeDaEtapa(cadencia.oportunidade.etapaId)}”`
              }
              icone="checklist"
            />
            <BotaoIniciarCadencia
              oportunidadeId={cadencia.oportunidade.id}
              etapaId={cadencia.oportunidade.etapaId}
              version={cadencia.oportunidade.version}
              onIniciado={() => {
                setErroDeInicio(null);
                void carregar();
                onMudou();
              }}
              onErro={(mensagem) => {
                setErroDeInicio(mensagem);
                void carregar();
              }}
            />
            {erroDeInicio && (
              <p role="alert" className="font-body-sm text-body-sm text-danger-text">
                {erroDeInicio}
              </p>
            )}
          </div>
        )}

        {!carregando && !erro && cadencia && cadencia.iniciada && (
          <>
            <ResumoCadencia cadencia={cadencia} />
            {cadencia.toqueDaVez && (
              <ToqueDaVez
                cardId={cardId}
                toque={cadencia.toqueDaVez}
                concluindo={concluindo}
                mensagemDeErro={erroDeConclusao}
                onConcluir={concluir}
              />
            )}
            <MatrizToques toques={cadencia.toques} />
            <HistoricoToques cardId={cardId} toques={cadencia.toques} />
          </>
        )}
      </div>
    </div>
  );
}

export default function PipelineCadenciaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Concluir um toque ou iniciar a régua refaz o número da aba "Cadência" no molde.
  const [versao, setVersao] = useState(0);

  return (
    <MoldeDoCard cardId={id} aba="cadencia" versaoDosContadores={versao} alturaFixa>
      {(card) => <ConteudoCadencia cardId={card.id} onMudou={() => setVersao((atual) => atual + 1)} />}
    </MoldeDoCard>
  );
}
