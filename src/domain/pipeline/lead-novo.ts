// Regra do selo "Novo" no card da Entrada de leads.
//
// O selo NÃO expira por tempo: ele fica enquanto o lead não teve interação, ou seja,
// enquanto o card continua na Entrada de leads. Iniciar a cadência move o card para a
// etapa seguinte — é isso que tira o selo (a checagem de etapa fica no card).
//
// O que muda com o tempo é a COR, para mostrar que o lead está parado há muito tempo.
// O tempo de espera não conta sábado e domingo (horário de Brasília — a operação é
// daqui), senão todo lead de fim de semana chegaria vermelho na segunda.

const FUSO = 'America/Sao_Paulo';
const HORA_MS = 60 * 60 * 1000;

/** Até aqui o lead é "fresco" (verde). */
export const LIMITE_VERDE_MS = 4 * HORA_MS;
/** Daqui em diante o lead está parado há muito tempo (vermelho). Entre os dois: amarelo. */
export const LIMITE_AMARELO_MS = 24 * HORA_MS;

export type UrgenciaDoLead = 'recente' | 'atencao' | 'parado';

const formatadorDia = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' });

function ehFimDeSemana(data: Date): boolean {
  const dia = formatadorDia.format(data);
  return dia === 'Sat' || dia === 'Sun';
}

/**
 * Tempo de espera em milissegundos, sem contar sábados e domingos.
 * Anda em passos de 1 hora; o erro máximo é de uma hora nas viradas de dia.
 */
export function esperaUtilMs(desde: Date, ate: Date): number {
  const fim = ate.getTime();
  let total = 0;
  for (let t = desde.getTime(); t < fim; t += HORA_MS) {
    const passo = Math.min(HORA_MS, fim - t);
    if (!ehFimDeSemana(new Date(t))) total += passo;
  }
  return total;
}

/** Urgência (cor) do selo para a espera já decorrida. */
export function urgenciaDaEspera(esperaMs: number): UrgenciaDoLead {
  if (esperaMs < LIMITE_VERDE_MS) return 'recente';
  if (esperaMs < LIMITE_AMARELO_MS) return 'atencao';
  return 'parado';
}

/**
 * Urgência do lead que ainda não teve interação, ou `null` quando a data é inválida
 * ou está no futuro (nesses casos não mostra selo).
 */
export function urgenciaDoLead(criadoEm: Date | string | null | undefined, agora: Date): UrgenciaDoLead | null {
  if (!criadoEm) return null;
  const data = criadoEm instanceof Date ? criadoEm : new Date(criadoEm);
  if (Number.isNaN(data.getTime()) || data.getTime() > agora.getTime()) return null;
  return urgenciaDaEspera(esperaUtilMs(data, agora));
}
