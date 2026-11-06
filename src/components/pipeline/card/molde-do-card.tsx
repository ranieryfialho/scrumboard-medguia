'use client';

// T-171 (fase4-card-abas, US-111, AC-419 a AC-422): o molde das três telas
// novas do card (Cadência, WhatsApp e Anexos). Carrega o card, trata
// carregando, erro e "não encontrado" e desenha o cabeçalho (o mesmo
// `CabecalhoCard` do Resumo, sem as ações de etapa) e a barra de abas.
// O Resumo não usa este molde (ASM-141): ele tem o próprio estado e só adota
// `AbasDoCard`, para os testes dele seguirem valendo.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';

import { CabecalhoCard } from '@/components/pipeline/detalhe/cabecalho-card';
import { nomeDaEtapa } from '@/components/pipeline/detalhe/jornada';
import { EsqueletoCarregando, EstadoErro } from '@/components/pipeline/pecas/estados';
import { ModalDadoFaltante } from '@/components/pipeline/modal-dado-faltante';
import { ModalFechamentoDoCard } from '@/components/pipeline/modal-fechamento';
import { AbasDoCard, type AbaDoCard } from './abas-do-card';
import { useContadoresDoCard } from './use-contadores-do-card';
import { useTransicaoDoCard } from './use-transicao-do-card';

export interface CardDoMolde {
  id: string;
  leadId: string;
  etapaId: number;
  leadNome: string;
  telefoneE164?: string | null;
  responsavelNome: string | null;
  valor?: string | null;
  version: number;
}

interface MoldeDoCardProps {
  cardId: string;
  aba: Exclude<AbaDoCard, 'resumo'>;
  /** Mudar este número refaz a busca dos contadores (ex.: depois de enviar um anexo). */
  versaoDosContadores?: number;
  /** AC-748: a tela ocupa a altura da janela (menos o topo) e o conteúdo rola por dentro; só a partir da largura `lg`. */
  alturaFixa?: boolean;
  children: (card: CardDoMolde) => ReactNode;
}

export function MoldeDoCard({ cardId, aba, versaoDosContadores = 0, alturaFixa = false, children }: MoldeDoCardProps) {
  const [card, setCard] = useState<CardDoMolde | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const contagens = useContadoresDoCard(card ? cardId : null, versaoDosContadores);
  // T-288 (AC-739): mover de etapa, ganho e perdido também nas abas; ao mover, o cabeçalho passa a mostrar a etapa nova.
  const transicao = useTransicaoDoCard(
    card,
    useCallback((etapaId: number, version: number) => setCard((atual) => (atual ? { ...atual, etapaId, version } : atual)), [])
  );

  const carregar = useCallback(async () => {
    setErro(false);
    setNaoEncontrado(false);
    setCarregando(true);
    try {
      const resposta = await fetch(`/api/oportunidades/${cardId}`);
      if (resposta.status === 404) {
        setNaoEncontrado(true);
        return;
      }
      if (!resposta.ok) throw new Error(`card respondeu ${resposta.status}`);
      setCard((await resposta.json()) as CardDoMolde);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [cardId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

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
        <EstadoErro onTentarDeNovo={carregar} />
      </div>
    );
  }

  // AC-421: id inexistente ou de outra empresa — mesma mensagem nos dois casos.
  if (naoEncontrado || !card) {
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
    <div className={alturaFixa ? 'flex flex-col w-full lg:h-[calc(100dvh-4rem)] lg:min-h-[40rem]' : 'flex flex-col w-full'}>
      <CabecalhoCard
        leadId={card.leadId}
        leadNome={card.leadNome}
        etapaAtualNome={nomeDaEtapa(card.etapaId)}
        responsavelNome={card.responsavelNome}
        etapasDestino={transicao.etapasDestino}
        podeMarcarGanho={transicao.podeMarcarGanho}
        podeMarcarPerdido={transicao.podeMarcarPerdido}
        enviando={transicao.enviando}
        onEscolherDestino={(etapaDestinoId) => void transicao.enviarTransicao(etapaDestinoId)}
      />
      {transicao.mensagem && (
        <div role="alert" className="mx-gutter mt-space-sm text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {transicao.mensagem}
        </div>
      )}
      {transicao.dadoFaltante && (
        <ModalDadoFaltante
          codigo={transicao.dadoFaltante.codigo}
          aberto
          oportunidadeId={card.id}
          onCancelar={transicao.cancelarDadoFaltante}
          onConfirmar={(dado) => void transicao.enviarTransicao(transicao.dadoFaltante!.etapaDestinoId, dado)}
        />
      )}
      {transicao.pedirFechamento && <ModalFechamentoDoCard cardId={card.id} modo="fechar" onCancelar={transicao.cancelarFechamento} onConfirmar={transicao.confirmarFechamento} />}
      <AbasDoCard cardId={card.id} ativa={aba} contagens={contagens} />
      {alturaFixa ? <div className="flex flex-col lg:flex-1 lg:min-h-0">{children(card)}</div> : children(card)}
    </div>
  );
}
