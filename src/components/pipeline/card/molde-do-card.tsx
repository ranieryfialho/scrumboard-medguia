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
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { AbasDoCard, type AbaDoCard } from './abas-do-card';
import { useContadoresDoCard } from './use-contadores-do-card';

export interface CardDoMolde {
  id: string;
  leadId: string;
  etapaId: number;
  leadNome: string;
  responsavelNome: string | null;
  version: number;
}

interface MoldeDoCardProps {
  cardId: string;
  aba: Exclude<AbaDoCard, 'resumo'>;
  /** Mudar este número refaz a busca dos contadores (ex.: depois de enviar um anexo). */
  versaoDosContadores?: number;
  children: (card: CardDoMolde) => ReactNode;
}

export function MoldeDoCard({ cardId, aba, versaoDosContadores = 0, children }: MoldeDoCardProps) {
  const [card, setCard] = useState<CardDoMolde | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const contagens = useContadoresDoCard(card ? cardId : null, versaoDosContadores);

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
    <div className="flex flex-col w-full">
      <CabecalhoCard
        leadNome={card.leadNome}
        etapaAtualNome={nomeDaEtapa(card.etapaId)}
        responsavelNome={card.responsavelNome}
        etapasDestino={[]}
        podeMarcarGanho={false}
        podeMarcarPerdido={false}
        enviando={false}
        onEscolherDestino={() => undefined}
        acoesExtras={
          <ItemEmBreve
            rotulo="Mover Etapa"
            icone="swap_horiz"
            className="h-10 px-3.5 rounded-lg bg-surface-subtle"
          />
        }
      />
      <AbasDoCard cardId={card.id} ativa={aba} contagens={contagens} />
      {children(card)}
    </div>
  );
}
