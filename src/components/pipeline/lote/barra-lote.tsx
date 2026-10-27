'use client';

// T-178 (fase4-pipeline-lote, AC-445): a barra azul de ações em lote da lista —
// "N selecionados" e as ações do protótipo (`7._pipeline_lista_vis_o_em_lista/`).
// "Mover Etapa em Lote", "Reatribuir Comercial" e "Arquivar" funcionam;
// "Disparar WhatsApp" continua "em breve" (Q-050). "Reatribuir" fica desabilitado
// para quem não é MASTER/GERENTE (a API também recusa, AC-451).
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import type { AcaoEmLote } from './tipos';

interface BarraLoteProps {
  quantidade: number;
  podeReatribuir: boolean;
  onAbrir: (acao: AcaoEmLote) => void;
}

const BOTAO =
  'px-3 py-1.5 rounded-lg bg-surface-card text-text-primary hover:bg-primary hover:text-on-primary font-label-md text-label-md font-semibold flex items-center gap-1.5 transition-colors shadow-sm';

export function BarraLote({ quantidade, podeReatribuir, onAbrir }: BarraLoteProps) {
  if (quantidade === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-info-surface text-info-text text-label-md font-label-md">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
          checklist
        </span>
        <strong>{quantidade} selecionados</strong>
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onAbrir('mover')} className={BOTAO}>
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            drive_file_move
          </span>
          Mover Etapa em Lote
        </button>
        <button
          type="button"
          disabled={!podeReatribuir}
          title={podeReatribuir ? undefined : 'Só MASTER e GERENTE reatribuem'}
          onClick={() => onAbrir('reatribuir')}
          className={`${BOTAO} disabled:opacity-50 disabled:hover:bg-surface-card disabled:hover:text-text-primary disabled:cursor-not-allowed`}
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            person_add
          </span>
          Reatribuir Comercial
        </button>
        <ItemEmBreve rotulo="Disparar WhatsApp" icone="send" />
        <button type="button" onClick={() => onAbrir('arquivar')} className={`${BOTAO} hover:bg-danger-text`}>
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            archive
          </span>
          Arquivar
        </button>
      </div>
    </div>
  );
}
