'use client';

// T-288 (fase4-card-abas, US-111, AC-739): mover o card de etapa (e marcar como ganho ou perdido) a partir das abas Cadência,
// WhatsApp e Anexos — o mesmo caminho do Resumo (`GET /api/oportunidades?etapaId=` para os destinos que o papel alcança e
// `POST /api/oportunidades/:id/transicao`, com o modal de dado faltante), só que como hook, sem mexer na página do Resumo.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CodigoErroTransicao } from '@/domain/pipeline/tipos';
import { exigeDadoFaltante } from '@/domain/pipeline/classificar-erro-transicao';
import type { EtapaOpcao } from '@/components/pipeline/detalhe/cabecalho-card';
import { nomeDaEtapa } from '@/components/pipeline/detalhe/jornada';
import type { DadoPreenchido } from '@/components/pipeline/modal-dado-faltante';
import type { DadosFechamento } from '@/domain/pipeline/fechamento';

const ETAPA_PERDIDO = 14;
const ETAPA_CONTRATO_GANHO = 15;

const MENSAGENS_ERRO: Partial<Record<CodigoErroTransicao, string>> = {
  TRANSICAO_NAO_PERMITIDA: 'Essa etapa não pode ser alcançada a partir da etapa atual.',
  PAPEL_NAO_PERMITIDO: 'Seu papel não tem permissão para fazer essa transição.',
};

export interface DadoFaltantePendente {
  etapaDestinoId: number;
  codigo: CodigoErroTransicao;
}

interface CardParaTransicao {
  id: string;
  etapaId: number;
  version: number;
}

export function useTransicaoDoCard(card: CardParaTransicao | null, aoMover: (etapaId: number, version: number) => void) {
  const [etapasDestino, setEtapasDestino] = useState<EtapaOpcao[]>([]);
  const [podeMarcarGanho, setPodeMarcarGanho] = useState(false);
  const [podeMarcarPerdido, setPodeMarcarPerdido] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [dadoFaltante, setDadoFaltante] = useState<DadoFaltantePendente | null>(null);
  // T-313: ir para "Contrato (Ganho)" primeiro pede os dados do fechamento (como no CRM antigo).
  const fechamentoRef = useRef<DadosFechamento | null>(null);
  // Os dados que o modal já pediu (valor, próxima ação...) ficam guardados entre uma tentativa e outra: o servidor pede um por vez e cada
  // reenvio precisa levar todos, senão o anterior se perde e o modal volta a pedi-lo (loop ao mover para Proposta).
  const dadosPedidosRef = useRef<DadoPreenchido>({});
  const [pedirFechamento, setPedirFechamento] = useState(false);

  const etapaAtualId = card?.etapaId ?? null;

  useEffect(() => {
    if (etapaAtualId === null) return;
    let cancelado = false;
    fetch(`/api/oportunidades?etapaId=${etapaAtualId}`)
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo: { grafo?: Record<number, number[]> } | null) => {
        if (cancelado || !corpo) return;
        const alcancaveis = corpo.grafo?.[etapaAtualId] ?? [];
        setEtapasDestino(
          alcancaveis
            .filter((id) => id !== ETAPA_PERDIDO && id !== ETAPA_CONTRATO_GANHO)
            .map((id) => ({ id, nome: nomeDaEtapa(id) }))
        );
        setPodeMarcarGanho(alcancaveis.includes(ETAPA_CONTRATO_GANHO));
        setPodeMarcarPerdido(alcancaveis.includes(ETAPA_PERDIDO));
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [etapaAtualId]);

  const enviarTransicao = useCallback(
    async (etapaDestinoId: number, dadoExtra?: DadoPreenchido) => {
      if (!card) return;
      if (etapaDestinoId === ETAPA_CONTRATO_GANHO && !fechamentoRef.current) {
        setPedirFechamento(true);
        return;
      }
      dadosPedidosRef.current = dadoExtra ? { ...dadosPedidosRef.current, ...dadoExtra } : {};
      setEnviando(true);
      setMensagem(null);
      try {
        const resposta = await fetch(`/api/oportunidades/${card.id}/transicao`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version: card.version, etapaDestinoId, ...dadosPedidosRef.current, ...(etapaDestinoId === ETAPA_CONTRATO_GANHO && fechamentoRef.current ? { fechamento: fechamentoRef.current } : {}) }),
        });
        if (resposta.ok) {
          const movida = (await resposta.json()) as { etapaId: number; version: number };
          setDadoFaltante(null);
          fechamentoRef.current = null;
          dadosPedidosRef.current = {};
          aoMover(movida.etapaId, movida.version);
          return;
        }
        const corpoErro = (await resposta.json().catch(() => null)) as { codigo?: CodigoErroTransicao } | null;
        const codigo = corpoErro?.codigo;
        if (codigo && exigeDadoFaltante(codigo)) setDadoFaltante({ etapaDestinoId, codigo });
        else setMensagem((codigo && MENSAGENS_ERRO[codigo]) || 'Não foi possível mover o card.');
      } catch {
        setMensagem('Não foi possível mover o card.');
      } finally {
        setEnviando(false);
      }
    },
    [card, aoMover]
  );

  return {
    etapasDestino,
    podeMarcarGanho,
    podeMarcarPerdido,
    enviando,
    mensagem,
    dadoFaltante,
    cancelarDadoFaltante: () => {
      dadosPedidosRef.current = {};
      setDadoFaltante(null);
      fechamentoRef.current = null;
    },
    enviarTransicao,
    pedirFechamento,
    cancelarFechamento: () => setPedirFechamento(false),
    confirmarFechamento: (dados: DadosFechamento) => {
      fechamentoRef.current = dados;
      setPedirFechamento(false);
      void enviarTransicao(ETAPA_CONTRATO_GANHO);
    },
  };
}
