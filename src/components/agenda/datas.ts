// T-186 (fase4-tarefas-agenda, AC-484): matemática de calendário da agenda, só
// com dias `YYYY-MM-DD` de São Paulo (sem horário de verão desde 2019, ASM-168).
import type { VisaoAgenda } from './tipos';

const FUSO = 'America/Sao_Paulo';

function paraUtc(iso: string): Date {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function deUtc(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/** O dia de São Paulo de um instante. */
export function diaDe(instante: Date | string): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(instante)
  );
  return partes;
}

export function horaDe(instante: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(instante)
  );
}

export function somarDias(iso: string, dias: number): string {
  const d = paraUtc(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return deUtc(d);
}

export function inicioDaSemana(iso: string): string {
  const dia = paraUtc(iso).getUTCDay();
  return somarDias(iso, -((dia + 6) % 7));
}

function somarMeses(iso: string, meses: number): string {
  const d = paraUtc(iso);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return deUtc(d);
}

/** O período que a tela pede ao servidor: só o que está visível (AC-484). O mês cobre a grade de 6 semanas. */
export function periodoDaVisao(visao: VisaoAgenda, ref: string): { de: string; ate: string } {
  if (visao === 'dia') return { de: ref, ate: ref };
  if (visao === 'mes') {
    const primeiro = inicioDaSemana(`${ref.slice(0, 7)}-01`);
    return { de: primeiro, ate: somarDias(primeiro, 41) };
  }
  const segunda = inicioDaSemana(ref);
  return { de: segunda, ate: somarDias(segunda, 6) };
}

export function navegar(visao: VisaoAgenda, ref: string, direcao: -1 | 1): string {
  if (visao === 'dia') return somarDias(ref, direcao);
  if (visao === 'mes') return somarMeses(ref, direcao);
  return somarDias(ref, 7 * direcao);
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const DIAS_DA_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export function rotuloDoDia(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

export function rotuloDoPeriodo(visao: VisaoAgenda, ref: string): string {
  if (visao === 'dia') return rotuloDoDia(ref);
  if (visao === 'mes') {
    const [a, m] = ref.split('-').map(Number);
    return `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} de ${a}`;
  }
  const { de, ate } = periodoDaVisao(visao, ref);
  const [, m1, d1] = de.split('-').map(Number);
  const [a2, m2, d2] = ate.split('-').map(Number);
  return m1 === m2 ? `${d1} a ${d2} de ${MESES[m2 - 1]} de ${a2}` : `${d1} de ${MESES[m1 - 1]} a ${d2} de ${MESES[m2 - 1]} de ${a2}`;
}

export function diasDoPeriodo(de: string, quantidade: number): string[] {
  return Array.from({ length: quantidade }, (_, i) => somarDias(de, i));
}

/** Converte data + hora digitadas (horário de Brasília) em instante ISO. */
export function instanteDeBrasilia(data: string, hora: string): string {
  return new Date(`${data}T${hora}:00-03:00`).toISOString();
}
