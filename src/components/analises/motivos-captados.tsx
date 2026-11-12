'use client';

// fase6-perdas-por-lead (US-194, AC-819): o bloco "Motivos de perda dos leads captados" do relatório de marketing — dos leads que entraram
// no período, quantos já estão perdidos ("N de M") e o ranking dos motivos, com quantidade e porcentagem sobre os perdidos.
import { inteiro, porcentagem } from './comum';

export interface MotivosDosCaptadosView {
  perdidos: number;
  captados: number;
  motivos: { motivo: string; quantidade: number; percentual: number }[];
}

export function MotivosDosCaptadosBloco({ dados }: { dados: MotivosDosCaptadosView }) {
  return (
    <section aria-label="Motivos de perda dos leads captados" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm shrink-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col">
          <h2 className="font-headline-sm text-headline-sm text-text-primary">Motivos de perda dos leads captados</h2>
          <p className="font-body-sm text-body-sm text-text-muted">Dos leads que entraram no período, quantos já foram perdidos e por quê.</p>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-danger-surface text-danger-text font-label-sm text-label-sm">
          {inteiro(dados.perdidos)} de {inteiro(dados.captados)} {dados.captados === 1 ? 'lead captado' : 'leads captados'} perdidos
        </span>
      </div>
      {dados.motivos.length === 0 ? (
        <p className="font-body-md text-body-md text-text-secondary">Nenhuma perda entre os leads captados</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {dados.motivos.map((m, i) => (
            <li key={m.motivo} className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 font-label-md text-label-md text-text-primary">
                <span>
                  {i + 1}. {m.motivo}
                </span>
                <span className="shrink-0">
                  {inteiro(m.quantidade)} ({porcentagem(m.percentual / 100)})
                </span>
              </div>
              <div aria-hidden="true" className="h-1.5 rounded-full bg-surface-container overflow-hidden">
                <div className="h-full bg-danger-text" style={{ width: `${m.percentual}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
