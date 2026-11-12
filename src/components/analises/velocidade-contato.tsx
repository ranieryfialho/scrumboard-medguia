'use client';

// fase6-atendimento-lead (US-181, AC-784 a AC-787): o bloco "Velocidade do 1º contato" do relatório de marketing — o tempo da
// entrada do lead até a 1ª mensagem de WhatsApp enviada pelo CRM, em relógio corrido e só em horário comercial. Cada lado mostra
// mediana, média, quantos leads entraram na conta e as faixas de espera. Cores neutras: o número sozinho não diz se é bom ou ruim.
import Link from 'next/link';

import { type DiaDaSemana, type HorarioComercial, type ResumoDeEsperas } from '@/domain/atendimento/horario-comercial';
import { inteiro, porcentagem } from './comum';

export interface VelocidadeDoContato {
  corrido: ResumoDeEsperas;
  comercial: ResumoDeEsperas;
  horario: HorarioComercial;
  horarioPadrao: boolean;
}

/** AC-784: minutos até 2 h ("45 min"), horas até 2 dias ("19 h 41 min") e dias a partir daí ("3 d 4 h"). */
export function formatarEspera(minutos: number): string {
  if (minutos < 1) return 'menos de 1 min';
  if (minutos < 120) return `${Math.round(minutos)} min`;
  if (minutos < 2880) {
    const horas = Math.floor(minutos / 60);
    const resto = Math.round(minutos - horas * 60);
    return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
  }
  const dias = Math.floor(minutos / 1440);
  const horas = Math.round((minutos - dias * 1440) / 60);
  return horas === 0 ? `${dias} d` : `${dias} d ${horas} h`;
}

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

const FAIXAS: { chave: keyof ResumoDeEsperas['faixas']; rotulo: string }[] = [
  { chave: 'ate1h', rotulo: 'Até 1 h' },
  { chave: 'de1a4h', rotulo: '1 a 4 h' },
  { chave: 'de4a24h', rotulo: '4 a 24 h' },
  { chave: 'mais24h', rotulo: 'Mais de 24 h' },
];

function Lado({ titulo, ajuda, resumo }: { titulo: string; ajuda: string; resumo: ResumoDeEsperas }) {
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
              <span className="font-body-sm text-body-sm text-text-muted">mediana</span>
            </div>
            <div className="flex flex-col">
              <span className="font-label-lg text-label-lg text-text-primary">{formatarEspera(resumo.media ?? 0)}</span>
              <span className="font-body-sm text-body-sm text-text-muted">média</span>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-surface-card font-label-sm text-label-sm text-text-secondary">
              {inteiro(resumo.n)} {resumo.n === 1 ? 'lead' : 'leads'}
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {FAIXAS.map(({ chave, rotulo }) => {
              const faixa = resumo.faixas[chave];
              return (
                <li key={chave} className="flex items-center gap-2 font-body-sm text-body-sm">
                  <span className="w-24 shrink-0 text-text-secondary">{rotulo}</span>
                  <span aria-hidden="true" className="h-2 flex-1 rounded-full bg-surface-card overflow-hidden">
                    <span className="block h-full rounded-full bg-primary/70" style={{ width: `${faixa.percentual}%` }} />
                  </span>
                  <span className="w-28 shrink-0 text-right text-text-primary">
                    {inteiro(faixa.quantidade)} · {porcentagem(faixa.percentual / 100)}
                  </span>
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
        <Lado titulo="Relógio corrido" ajuda="conta noites e fins de semana" resumo={velocidade.corrido} />
        <Lado titulo="Horário comercial" ajuda="só os minutos dentro do expediente" resumo={velocidade.comercial} />
      </div>
    </section>
  );
}

