'use client';

// fase6-perdas-por-lead (US-193, AC-813 a AC-815): o bloco "Perda" do detalhe do card — por que, em que etapa, quando e de quem foi a
// perda. Só aparece com o card em "Perdido" (a API manda `perda: null` fora dele, e quando o card é reaberto o bloco some).
// O responsável é o atual do card (ASM-308). Perda da cadência esgotada leva a marca "Perda automática".

export interface PerdaDoCardView {
  motivo: string | null;
  etapaOrigem: string | null;
  /** ISO 8601; `null` quando o log não tem a transição (ex.: card migrado direto em Perdido). */
  ocorridoEm: string | null;
  automatica: boolean;
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

export function BlocoPerda({ perda, responsavelNome }: { perda: PerdaDoCardView | null | undefined; responsavelNome: string | null }) {
  if (!perda) return null;

  const linhas: [string, string][] = [
    ['Motivo', perda.motivo ?? 'Sem motivo informado'],
    ['Etapa em que estava', perda.etapaOrigem ?? 'Não registrada'],
    ['Responsável', responsavelNome ?? 'Sem responsável'],
    ['Perdido em', perda.ocorridoEm ? dataHora(perda.ocorridoEm) : 'Não registrado'],
  ];

  return (
    <section aria-label="Perda" className="bg-surface-card rounded-xl p-space-lg shadow-sm flex flex-col gap-space-sm">
      <div className="flex items-center justify-between gap-2 pb-space-sm border-b border-border-subtle">
        <h2 className="font-headline-sm text-headline-sm text-text-primary flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-danger-text">
            cancel
          </span>
          Perda
        </h2>
        {perda.automatica && <span className="px-2.5 py-1 rounded-full bg-surface-subtle text-text-secondary font-label-sm text-label-sm">Perda automática</span>}
      </div>
      <dl className="flex flex-col gap-space-sm">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="flex flex-col">
            <dt className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">{rotulo}</dt>
            <dd className="font-body-md text-body-md text-text-primary">{valor}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
