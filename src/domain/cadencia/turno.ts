// T-088 (fase2b-cadencia, US-052): domínio puro, sem I/O e sem `Date.now()` —
// o relógio é sempre recebido por parâmetro (ASM-062). Converte um instante
// absoluto para os componentes de calendário em `America/Sao_Paulo`, base
// para o turno vigente (AC-188) e para fim de semana/feriado (AC-189).

export type Turno = 'manha' | 'tarde';

const FUSO_SAO_PAULO = 'America/Sao_Paulo';

export interface DataLocalSaoPaulo {
  ano: number;
  mes: number; // 1-12
  dia: number; // 1-31
  /** 0 = domingo .. 6 = sábado, igual a `Date#getUTCDay`. */
  diaDaSemana: number;
  hora: number; // 0-23
}

export function dataLocalEmSaoPaulo(instante: Date): DataLocalSaoPaulo {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_SAO_PAULO,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(instante);

  const valorDe = (tipo: 'year' | 'month' | 'day' | 'hour'): number =>
    Number(partes.find((parte) => parte.type === tipo)?.value);

  const ano = valorDe('year');
  const mes = valorDe('month');
  const dia = valorDe('day');
  const hora = valorDe('hour');

  // O dia da semana é só calendário (y/m/d) — usar `Date.UTC` com os
  // componentes já locais evita qualquer confusão de fuso horário.
  const diaDaSemana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();

  return { ano, mes, dia, diaDaSemana, hora };
}

export function dataLocalISO(local: DataLocalSaoPaulo): string {
  const mes = String(local.mes).padStart(2, '0');
  const dia = String(local.dia).padStart(2, '0');
  return `${local.ano}-${mes}-${dia}`;
}

/** AC-188: 08h–11h59 é manhã, 13h–17h59 é tarde; fora disso não há turno vigente. */
export function turnoVigente(instante: Date): Turno | null {
  const { hora } = dataLocalEmSaoPaulo(instante);
  if (hora >= 8 && hora < 12) return 'manha';
  if (hora >= 13 && hora < 18) return 'tarde';
  return null;
}
