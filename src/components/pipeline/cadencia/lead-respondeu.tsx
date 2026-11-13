'use client';

// Fecha a lacuna do "Registrar Sucesso": o botão do toque da vez só existe com um toque pendente, e entre um turno e o seguinte (todos os
// toques do bloco feitos, próximo ainda não liberado) o closer ficava sem como avisar que o lead respondeu. Este painel aparece nesse
// intervalo e faz o mesmo que o sucesso: encerra a cadência e leva o card a Qualificando.
import { useState } from 'react';

import { ConfirmarSucesso } from '@/components/tarefas/confirmar-sucesso';

interface LeadRespondeuProps {
  concluindo: boolean;
  mensagemDeErro: string | null;
  onConfirmar: () => void;
}

export function LeadRespondeu({ concluindo, mensagemDeErro, onConfirmar }: LeadRespondeuProps) {
  const [confirmando, setConfirmando] = useState(false);
  return (
    <section aria-label="Aguardando o próximo turno" className="rounded-2xl bg-surface-card p-space-lg shadow-sm flex flex-col sm:flex-row gap-space-md justify-between sm:items-center">
      <div className="flex flex-col gap-1 min-w-0">
        <h3 className="font-headline-md text-headline-md text-text-primary">Aguardando o próximo turno</h3>
        <p className="font-body-md text-body-md text-text-secondary">
          Os toques deste turno foram feitos e o próximo ainda não foi liberado. Se o lead respondeu ou atendeu, registre agora.
        </p>
        {mensagemDeErro && (
          <p role="alert" className="font-body-sm text-body-sm bg-danger-surface text-danger-text rounded-lg px-3 py-2 w-fit">
            {mensagemDeErro}
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={concluindo}
        onClick={() => setConfirmando(true)}
        className="shrink-0 px-4 py-2 rounded-lg bg-success-surface text-success-text font-label-md text-label-md font-semibold flex items-center gap-1.5 disabled:opacity-60"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
          check_circle
        </span>
        O lead respondeu
      </button>
      {confirmando && (
        <ConfirmarSucesso
          nome="este lead"
          trabalhando={concluindo}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={() => {
            setConfirmando(false);
            onConfirmar();
          }}
        />
      )}
    </section>
  );
}
