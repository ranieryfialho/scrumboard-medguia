// T-088 (fase2b-cadencia, US-052): lista fixa versionada de feriados
// nacionais (ASM-057, Q-018) — sem API externa. Cobre 2026 e 2027; precisa
// ser estendida manualmente a cada novo ano. Inclui só os feriados nacionais
// fixados em lei (datas fixas + Sexta-feira Santa); Carnaval e Corpus Christi
// são ponto facultativo, não feriado nacional obrigatório, e ficam fora.
import { dataLocalEmSaoPaulo, dataLocalISO } from './turno';

export const FERIADOS_NACIONAIS: readonly string[] = [
  // 2026
  '2026-01-01', // Confraternização Universal
  '2026-04-03', // Sexta-feira Santa
  '2026-04-21', // Tiradentes
  '2026-05-01', // Dia do Trabalho
  '2026-09-07', // Independência
  '2026-10-12', // Nossa Senhora Aparecida
  '2026-11-02', // Finados
  '2026-11-15', // Proclamação da República
  '2026-11-20', // Dia Nacional de Zumbi e da Consciência Negra
  '2026-12-25', // Natal
  // 2027
  '2027-01-01',
  '2027-03-26', // Sexta-feira Santa
  '2027-04-21',
  '2027-05-01',
  '2027-09-07',
  '2027-10-12',
  '2027-11-02',
  '2027-11-15',
  '2027-11-20',
  '2027-12-25',
];

function eFimDeSemana(diaDaSemana: number): boolean {
  return diaDaSemana === 0 || diaDaSemana === 6;
}

export function eFeriadoNacional(dataISO: string): boolean {
  return FERIADOS_NACIONAIS.includes(dataISO);
}

/** AC-189: sábado, domingo e feriado nacional pausam a cadência; a data usada é a local em `America/Sao_Paulo`. */
export function podeLiberar(instante: Date): boolean {
  const local = dataLocalEmSaoPaulo(instante);
  if (eFimDeSemana(local.diaDaSemana)) return false;
  return !eFeriadoNacional(dataLocalISO(local));
}
