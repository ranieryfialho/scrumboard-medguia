'use client';

// T-173 (fase4-card-abas, US-113, AC-434/AC-436): o destaque do toque da vez com
// "Registrar Sucesso" (conectou) e "Não Atendeu" (sem resposta), que usam a
// mesma API da fila do turno. "Pediu Retorno Mais Tarde" e "Editar Script" não
// têm backend e ficam "em breve"; o script recomendado do protótipo não existe
// no sistema e não aparece. Fonte visual: `10._pipeline_id_cadencia_cad_ncia_do_card/`.
import { useState } from 'react';
import Link from 'next/link';

import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { ROTULO_CANAL, ROTULO_TIPO, ROTULO_TURNO, type ToqueDaCadencia } from './tipos';
import { rotuloSemResposta } from '@/components/tarefas/comum';
import { ConfirmarSucesso } from '@/components/tarefas/confirmar-sucesso';

interface ToqueDaVezProps {
  cardId: string;
  toque: ToqueDaCadencia;
  concluindo: boolean;
  mensagemDeErro: string | null;
  onConcluir: (resultado: 'conectou' | 'sem_resposta') => void;
}

export function ToqueDaVez({ cardId, toque, concluindo, mensagemDeErro, onConcluir }: ToqueDaVezProps) {
  // "Registrar Sucesso" encerra a cadência e move o card: pede a confirmação antes.
  const [confirmando, setConfirmando] = useState(false);
  return (
    <section
      aria-label="Toque da vez"
      className="rounded-2xl bg-sidebar-surface text-on-primary p-space-lg shadow-md flex flex-col lg:flex-row gap-space-lg justify-between"
    >
      <div className="flex flex-col gap-2 min-w-0">
        <span className="w-fit px-2.5 py-0.5 rounded-full bg-primary font-label-sm text-label-sm font-bold uppercase">
          Toque atual #{toque.sequencia}
        </span>
        <h3 className="font-headline-md text-headline-md">{ROTULO_TIPO[toque.tipo]}</h3>
        <p className="font-body-md text-body-md opacity-80">
          Dia {toque.dia} · Turno {ROTULO_TURNO[toque.turno]} · Canal: {ROTULO_CANAL[toque.canal]}
        </p>
        {toque.atrasado && (
          <span className="w-fit px-2 py-0.5 rounded bg-danger-surface text-danger-text font-label-sm text-label-sm font-bold">
            Atrasado
          </span>
        )}
        {toque.aguardandoAte && (
          <span className="w-fit px-2 py-0.5 rounded bg-warning-surface text-warning-text font-label-sm text-label-sm font-bold">
            Aguardando resposta até {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(toque.aguardandoAte))}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-space-sm lg:min-w-[22rem]">
        <p className="font-label-sm text-label-sm uppercase tracking-wider opacity-70 font-semibold">Registrar despacho imediato</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={concluindo}
            onClick={() => setConfirmando(true)}
            className="px-4 py-2 rounded-lg bg-success-surface text-success-text font-label-md text-label-md font-semibold flex items-center gap-1.5 disabled:opacity-60"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
              check_circle
            </span>
            Registrar Sucesso
          </button>
          <button
            type="button"
            disabled={concluindo}
            onClick={() => onConcluir('sem_resposta')}
            className="px-4 py-2 rounded-lg bg-surface-card text-text-primary font-label-md text-label-md font-semibold flex items-center gap-1.5 disabled:opacity-60"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
              {toque.canal === 'whatsapp' ? 'send' : 'phone_missed'}
            </span>
            {rotuloSemResposta(toque.canal)}
          </button>
          <ItemEmBreve rotulo="Pediu Retorno Mais Tarde" icone="schedule" className="px-3 py-2 rounded-lg bg-surface-card/10" />
          <ItemEmBreve rotulo="Editar Script" icone="edit_note" className="px-3 py-2 rounded-lg bg-surface-card/10" />
        </div>
        {toque.canal === 'whatsapp' && (
          <Link
            href={`/pipeline/${cardId}/conversa`}
            className="w-fit font-label-md text-label-md text-on-primary underline underline-offset-2"
          >
            Abrir conversa do WhatsApp
          </Link>
        )}
        {mensagemDeErro && (
          <p role="alert" className="font-body-sm text-body-sm bg-danger-surface text-danger-text rounded-lg px-3 py-2">
            {mensagemDeErro}
          </p>
        )}
      </div>
      {confirmando && (
        <ConfirmarSucesso
          nome="este lead"
          trabalhando={concluindo}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={() => {
            setConfirmando(false);
            onConcluir('conectou');
          }}
        />
      )}
    </section>
  );
}
