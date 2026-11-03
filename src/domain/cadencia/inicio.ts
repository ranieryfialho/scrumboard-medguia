// T-295 (fase2b-cadencia, US-053, AC-756/AC-757): domínio puro, sem I/O e sem `Date.now()` (ASM-062) — em qual turno nasce o primeiro
// bloco de uma cadência iniciada num dado instante, e a partir de quando ele vale. Espelha em TypeScript a função SQL
// `cadencia_primeiro_bloco` (drizzle/0028); `test/db/cadencia-inicio.test.ts` compara as duas.
import { podeLiberar } from './feriados';
import { dataLocalEmSaoPaulo, type Turno } from './turno';

export interface PrimeiroBloco {
  turno: Turno;
  /** Quando o bloco passa a valer (os toques ficam "do turno" a partir daí; antes disso a fila não os mostra). */
  liberadaEm: Date;
}

/** Instante de `hora`h em São Paulo (UTC-3, sem horário de verão desde 2019) no dia local `ano-mes-dia`. */
function saoPauloAs(ano: number, mes: number, dia: number, hora: number): Date {
  return new Date(Date.UTC(ano, mes - 1, dia, hora + 3));
}

export function primeiroBlocoDaCadencia(agora: Date): PrimeiroBloco {
  const local = dataLocalEmSaoPaulo(agora);

  if (podeLiberar(agora)) {
    if (local.hora >= 13 && local.hora < 18) return { turno: 'tarde', liberadaEm: agora };
    if (local.hora === 12) return { turno: 'tarde', liberadaEm: saoPauloAs(local.ano, local.mes, local.dia, 13) };
    if (local.hora < 8) return { turno: 'manha', liberadaEm: saoPauloAs(local.ano, local.mes, local.dia, 8) };
    if (local.hora < 12) return { turno: 'manha', liberadaEm: agora };
  }

  // depois das 18h, fim de semana ou feriado: 8h do próximo dia útil
  let proximo = new Date(saoPauloAs(local.ano, local.mes, local.dia, 12).getTime() + 24 * 3600_000);
  while (!podeLiberar(proximo)) proximo = new Date(proximo.getTime() + 24 * 3600_000);
  const dia = dataLocalEmSaoPaulo(proximo);
  return { turno: 'manha', liberadaEm: saoPauloAs(dia.ano, dia.mes, dia.dia, 8) };
}
