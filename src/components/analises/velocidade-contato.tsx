'use client';

// fase6-atendimento-lead (US-181, AC-784 a AC-787): o bloco "Velocidade do 1º contato" do relatório de marketing — o tempo da
// entrada do lead até a 1ª mensagem de WhatsApp enviada pelo CRM, em relógio corrido e só em horário comercial. Cada lado mostra
// mediana, média, quantos leads entraram na conta e as faixas de espera. Cores neutras: o número sozinho não diz se é bom ou ruim.
import Link from 'next/link';
import { useId, useState } from 'react';

import { type ChaveDeFaixa, type DiaDaSemana, type HorarioComercial, type ResumoDeEsperas } from '@/domain/atendimento/horario-comercial';
import { inteiro, porcentagem } from './comum';
import { LeadsDaVelocidade, formatarEspera, type FiltroDeFaixa, type LeadDaVelocidadeView } from './leads-da-velocidade';

export interface VelocidadeDoContato {
  corrido: ResumoDeEsperas;
  comercial: ResumoDeEsperas;
  horario: HorarioComercial;
  horarioPadrao: boolean;
  /** Os leads da conta (AC-826); ausente = só os resumos. */
  leads?: LeadDaVelocidadeView[];
}

export { formatarEspera };

const NOME_CURTO: Record<DiaDaSemana, string> = { dom: 'Dom', seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb' };
const ORDEM = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'] as const satisfies readonly DiaDaSemana[];

/** "Seg a sex, 09:00–18:00" (dias seguidos com o mesmo horário viram um intervalo). */
export function resumoDoExpediente(horario: HorarioComercial): string {
  const grupos: { de: DiaDaSemana; ate: DiaDaSemana; abre: string; fecha: string }[] = [];
  for (const dia of ORDEM) {
    const item = horario[dia];
    if (!item.atende) continue;
    const ultimo = grupos[grupos.length - 1];
    const anterior = ultimo && ORDEM.indexOf(ultimo.ate) === ORDEM.indexOf(dia) - 1;
    if (ultimo && anterior && ultimo.abre === item.abre && ultimo.fecha === item.fecha) ultimo.ate = dia;
    else grupos.push({ de: dia, ate: dia, abre: item.abre, fecha: item.fecha });
  }
  return grupos.map((g) => `${g.de === g.ate ? NOME_CURTO[g.de] : `${NOME_CURTO[g.de]} a ${NOME_CURTO[g.ate].toLowerCase()}`}, ${g.abre}–${g.fecha}`).join(' · ');
}

export const DICA_DA_MEDIANA =
  'O valor do meio: se você ordenar as esperas da menor para a maior, é a que fica no centro. Metade dos leads esperou menos que isso e metade esperou mais. É o melhor retrato do atendimento típico, porque casos muito longos quase não mexem nela.';
export const DICA_DA_MEDIA =
  'A soma de todas as esperas dividida pelo número de leads. Casos muito longos puxam a média para cima: se ela for bem maior que a mediana, há um grupo de leads esperando muito mais que os demais (veja as faixas abaixo).';

/** Rótulo com um balão de explicação: abre ao passar o mouse e ao focar pelo teclado. */
function Dica({ rotulo, texto }: { rotulo: string; texto: string }) {
  const id = useId();
  return (
    <span className="group relative inline-flex w-fit items-center gap-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-primary/40" tabIndex={0} aria-describedby={id}>
      <span>{rotulo}</span>
      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
        info
      </span>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute left-0 bottom-full z-30 mb-2 hidden w-64 rounded-lg border border-border-subtle bg-surface-card px-3 py-2 font-body-sm text-body-sm text-text-primary normal-case shadow-lg group-hover:block group-focus:block"
      >
        {texto}
      </span>
    </span>
  );
}

export const FAIXAS: { chave: ChaveDeFaixa; rotulo: string }[] = [
  { chave: 'ate1h', rotulo: 'Até 1 h' },
  { chave: 'de1a4h', rotulo: '1 a 4 h' },
  { chave: 'de4a24h', rotulo: '4 a 24 h' },
  { chave: 'mais24h', rotulo: 'Mais de 24 h' },
];

interface PropsDoLado {
  titulo: string;
  ajuda: string;
  resumo: ResumoDeEsperas;
  /** Faixa escolhida neste lado (a lista abaixo filtra por ela); `null` quando não há lista. */
  ativa?: ChaveDeFaixa | null;
  onEscolher?: (faixa: ChaveDeFaixa) => void;
}

function Lado({ titulo, ajuda, resumo, ativa, onEscolher }: PropsDoLado) {
  return (
    <article aria-label={titulo} className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-2">
      <div className="flex flex-col">
        <span className="font-label-sm text-label-sm text-text-muted uppercase">{titulo}</span>
        <span className="font-body-sm text-body-sm text-text-muted">{ajuda}</span>
      </div>
      {resumo.n === 0 ? (
        <span className="font-label-lg text-label-lg text-text-primary">Sem contatos</span>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div className="flex flex-col">
              <span className="font-headline-sm text-headline-sm text-text-primary">{formatarEspera(resumo.mediana ?? 0)}</span>
              <span className="font-body-sm text-body-sm text-text-muted">
                <Dica rotulo="mediana" texto={DICA_DA_MEDIANA} />
              </span>
            </div>
            <div className="flex flex-col">
              <span className="font-label-lg text-label-lg text-text-primary">{formatarEspera(resumo.media ?? 0)}</span>
              <span className="font-body-sm text-body-sm text-text-muted">
                <Dica rotulo="média" texto={DICA_DA_MEDIA} />
              </span>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-surface-card font-label-sm text-label-sm text-text-secondary">
              {inteiro(resumo.n)} {resumo.n === 1 ? 'lead' : 'leads'}
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {FAIXAS.map(({ chave, rotulo }) => {
              const faixa = resumo.faixas[chave];
              return (
                <li key={chave}>
                  <button
                    type="button"
                    disabled={!onEscolher || faixa.quantidade === 0}
                    aria-pressed={ativa === chave}
                    aria-label={`${titulo}: ${rotulo}`}
                    onClick={() => onEscolher?.(chave)}
                    className={`w-full flex items-center gap-2 rounded px-1 py-0.5 font-body-sm text-body-sm text-left enabled:hover:bg-surface-card enabled:cursor-pointer ${ativa === chave ? 'bg-surface-card ring-1 ring-primary/40' : ''}`}
                  >
                    <span className="w-24 shrink-0 text-text-secondary">{rotulo}</span>
                    <span aria-hidden="true" className="h-2 flex-1 rounded-full bg-surface-card overflow-hidden">
                      <span className="block h-full rounded-full bg-primary/70" style={{ width: `${faixa.percentual}%` }} />
                    </span>
                    <span className="w-28 shrink-0 text-right text-text-primary">
                      {inteiro(faixa.quantidade)} · {porcentagem(faixa.percentual / 100)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </article>
  );
}

export function VelocidadeDoContatoBloco({ velocidade }: { velocidade: VelocidadeDoContato }) {
  const [filtro, setFiltro] = useState<FiltroDeFaixa | null>(null);
  const temLista = (velocidade.leads?.length ?? 0) > 0;
  const escolher = (criterio: FiltroDeFaixa['criterio']) => (faixa: ChaveDeFaixa) =>
    setFiltro((atual) => (atual?.criterio === criterio && atual.faixa === faixa ? null : { criterio, faixa }));
  return (
    <section aria-label="Velocidade do 1º contato" className="flex flex-col gap-space-sm">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div className="flex flex-col">
          <h3 className="font-label-lg text-label-lg text-text-primary">Velocidade do 1º contato</h3>
          <span className="font-body-sm text-body-sm text-text-muted">da entrada do lead até a 1ª mensagem enviada pelo CRM (WhatsApp)</span>
        </div>
        <Link href="/configuracoes/horario-atendimento" className="font-label-md text-label-md text-primary hover:underline">
          Horário comercial: {resumoDoExpediente(velocidade.horario)}
          {velocidade.horarioPadrao ? ' (padrão)' : ''}
        </Link>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-sm">
        <Lado titulo="Relógio corrido" ajuda="conta noites e fins de semana" resumo={velocidade.corrido} ativa={filtro?.criterio === 'corrido' ? filtro.faixa : null} onEscolher={temLista ? escolher('corrido') : undefined} />
        <Lado titulo="Horário comercial" ajuda="só os minutos dentro do expediente" resumo={velocidade.comercial} ativa={filtro?.criterio === 'comercial' ? filtro.faixa : null} onEscolher={temLista ? escolher('comercial') : undefined} />
      </div>
      {temLista && <LeadsDaVelocidade leads={velocidade.leads!} filtro={filtro} onLimparFiltro={() => setFiltro(null)} />}
    </section>
  );
}

