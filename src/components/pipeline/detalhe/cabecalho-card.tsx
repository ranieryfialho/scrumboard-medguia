// T-163 (fase4-pipeline-telas, US-109): cabeçalho do detalhe — lead, etapa
// atual, responsável (AC-406) e as três ações que respeitam o grafo do
// pipeline (AC-410): "Mover de Etapa" só lista destinos alcançáveis pelo
// papel (excluindo Ganho/Perdido, que têm botão próprio); "Marcar como
// Ganho"/"Perdido" só aparecem quando a etapa 15/14 está entre os destinos
// alcançáveis. Quem decide o que é "alcançável" é `page.tsx` (a partir do
// mesmo `grafo` que `GET /api/oportunidades` já calcula filtrado por papel,
// T-046/AC-094) — este componente só mostra o que recebe.
import type { ReactNode } from 'react';
import Link from 'next/link';

import { SeloEtapa } from '@/components/pipeline/pecas/selo-etapa';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';

export interface EtapaOpcao {
  id: number;
  nome: string;
}

interface CabecalhoCardProps {
  leadNome: string;
  etapaAtualNome: string;
  responsavelNome: string | null;
  etapasDestino: EtapaOpcao[];
  podeMarcarGanho: boolean;
  podeMarcarPerdido: boolean;
  enviando: boolean;
  onEscolherDestino: (etapaDestinoId: number) => void;
  /** T-171: itens extras nas ações (ex.: "Mover Etapa" em breve nas abas que não movem card). */
  acoesExtras?: ReactNode;
}

export function CabecalhoCard({
  leadNome,
  etapaAtualNome,
  responsavelNome,
  etapasDestino,
  podeMarcarGanho,
  podeMarcarPerdido,
  enviando,
  onEscolherDestino,
  acoesExtras,
}: CabecalhoCardProps) {
  return (
    <div className="px-gutter pt-space-lg pb-space-md bg-surface-card shadow-sm">
      <div className="flex flex-col gap-space-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
          <div className="flex flex-col gap-1">
            <Link
              href="/pipeline"
              className="font-label-sm text-label-sm text-text-muted hover:text-primary transition-colors flex items-center gap-1 w-fit"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[15px]">
                arrow_back
              </span>
              Voltar ao funil
            </Link>
            <div className="flex items-center gap-space-sm mt-1 flex-wrap">
              <h1 className="font-headline-lg text-headline-lg text-text-primary">{leadNome}</h1>
              <SeloEtapa nome={etapaAtualNome} />
            </div>
            <p className="font-body-sm text-body-sm text-text-secondary">
              Responsável: {responsavelNome ?? 'Sem responsável'}
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            {etapasDestino.length > 0 && (
              <div>
                <label htmlFor="cabecalho-mover-etapa" className="sr-only">
                  Mover de Etapa
                </label>
                <select
                  id="cabecalho-mover-etapa"
                  disabled={enviando}
                  value=""
                  onChange={(evento) => {
                    const etapaDestinoId = Number(evento.target.value);
                    if (etapaDestinoId) onEscolherDestino(etapaDestinoId);
                    evento.target.value = '';
                  }}
                  className="h-10 px-3.5 rounded-lg bg-surface-subtle hover:bg-surface-container-high text-text-primary font-label-lg text-label-lg shadow-sm transition-all disabled:opacity-50"
                >
                  <option value="">Mover de Etapa</option>
                  {etapasDestino.map((etapa) => (
                    <option key={etapa.id} value={etapa.id}>
                      {etapa.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {podeMarcarGanho && (
              <button
                type="button"
                disabled={enviando}
                onClick={() => onEscolherDestino(15)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-success-text hover:bg-emerald-700 text-on-primary font-label-lg text-label-lg shadow-sm transition-all disabled:opacity-50"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                  verified
                </span>
                Marcar como Ganho
              </button>
            )}

            {podeMarcarPerdido && (
              <button
                type="button"
                disabled={enviando}
                onClick={() => onEscolherDestino(14)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-danger-surface hover:bg-rose-200 text-danger-text font-label-md text-label-md transition-all disabled:opacity-50"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
                  close
                </span>
                Perdido
              </button>
            )}

            {acoesExtras}

            <ItemEmBreve
              rotulo="Editar Informações"
              icone="edit"
              className="p-2 rounded-lg bg-surface-subtle hover:bg-surface-container-high"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
