// fase6-atendimento-lead (US-181/US-182): domínio puro (sem I/O e sem `Date.now()`) do horário comercial e do tempo de espera do
// 1º contato. O expediente é por empresa, em `America/Sao_Paulo` (sem horário de verão desde 2019, então a conta usa o fuso fixo
// -03:00, como o resto do projeto). Feriado não é considerado (ASM-307): dia marcado como "Atende" vale inteiro.
import { dataLocalEmSaoPaulo } from '../cadencia/turno';

export const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
export type DiaDaSemana = (typeof DIAS_DA_SEMANA)[number];

export interface ExpedienteDoDia {
  atende: boolean;
  /** `HH:MM`, 24 h. */
  abre: string;
  /** `HH:MM`, 24 h. Depois de `abre` nos dias em que atende. */
  fecha: string;
}

export type HorarioComercial = Record<DiaDaSemana, ExpedienteDoDia>;

/** Segunda a sexta, 09:00 às 18:00; sábado e domingo sem atendimento. */
export const HORARIO_PADRAO: HorarioComercial = {
  dom: { atende: false, abre: '09:00', fecha: '18:00' },
  seg: { atende: true, abre: '09:00', fecha: '18:00' },
  ter: { atende: true, abre: '09:00', fecha: '18:00' },
  qua: { atende: true, abre: '09:00', fecha: '18:00' },
  qui: { atende: true, abre: '09:00', fecha: '18:00' },
  sex: { atende: true, abre: '09:00', fecha: '18:00' },
  sab: { atende: false, abre: '09:00', fecha: '18:00' },
};

const FORMATO_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutosDoDia(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

export type ResultadoValidacaoHorario = { ok: true; horario: HorarioComercial } | { ok: false; mensagem: string };

/**
 * AC-791: confere um horário vindo de fora (corpo da rota ou valor gravado). Recusa dia que falta, hora fora de `HH:MM`, fechamento
 * que não é depois da abertura (nos dias em que atende) e horário sem nenhum dia de atendimento. Só devolve campos conhecidos.
 */
export function validarHorario(valor: unknown): ResultadoValidacaoHorario {
  if (typeof valor !== 'object' || valor === null) return { ok: false, mensagem: 'Informe o horário de atendimento.' };
  const bruto = valor as Record<string, unknown>;
  const horario = {} as HorarioComercial;

  for (const dia of DIAS_DA_SEMANA) {
    const item = bruto[dia] as Partial<ExpedienteDoDia> | undefined;
    if (typeof item !== 'object' || item === null || typeof item.atende !== 'boolean') {
      return { ok: false, mensagem: `Informe se a empresa atende em cada dia da semana (falta: ${dia}).` };
    }
    if (typeof item.abre !== 'string' || !FORMATO_HORA.test(item.abre) || typeof item.fecha !== 'string' || !FORMATO_HORA.test(item.fecha)) {
      return { ok: false, mensagem: 'Use horários no formato HH:MM (de 00:00 a 23:59).' };
    }
    if (item.atende && minutosDoDia(item.fecha) <= minutosDoDia(item.abre)) {
      return { ok: false, mensagem: 'O horário de fechamento precisa ser depois do de abertura.' };
    }
    horario[dia] = { atende: item.atende, abre: item.abre, fecha: item.fecha };
  }

  if (!DIAS_DA_SEMANA.some((dia) => horario[dia].atende)) {
    return { ok: false, mensagem: 'Marque pelo menos um dia de atendimento.' };
  }
  return { ok: true, horario };
}

const MS_POR_MINUTO = 60_000;
const MS_POR_DIA = 24 * 60 * MS_POR_MINUTO;
/** Meia-noite local (UTC-3) de `ano-mes-dia`, em UTC. */
function meiaNoiteLocal(ano: number, mes: number, dia: number): number {
  return Date.UTC(ano, mes - 1, dia, 3, 0, 0);
}

/**
 * AC-785: quantos minutos entre `inicio` e `fim` caem dentro do expediente. Entrou na sexta às 17h30 e foi atendido na segunda às
 * 9h30, com expediente de 9h às 18h de segunda a sexta, são 30 + 30 = 60. Fim antes do início dá 0.
 */
export function minutosUteis(inicio: Date, fim: Date, horario: HorarioComercial = HORARIO_PADRAO): number {
  if (fim.getTime() <= inicio.getTime()) return 0;

  const primeiro = dataLocalEmSaoPaulo(inicio);
  const ultimo = dataLocalEmSaoPaulo(fim);
  const diaFinal = meiaNoiteLocal(ultimo.ano, ultimo.mes, ultimo.dia);

  let totalMs = 0;
  for (let meiaNoite = meiaNoiteLocal(primeiro.ano, primeiro.mes, primeiro.dia); meiaNoite <= diaFinal; meiaNoite += MS_POR_DIA) {
    // O dia da semana é só calendário: a meia-noite local em UTC cai sempre às 03:00 do mesmo dia civil.
    const expediente = horario[DIAS_DA_SEMANA[new Date(meiaNoite).getUTCDay()]];
    if (!expediente.atende) continue;
    const abre = meiaNoite + minutosDoDia(expediente.abre) * MS_POR_MINUTO;
    const fecha = meiaNoite + minutosDoDia(expediente.fecha) * MS_POR_MINUTO;
    const de = Math.max(abre, inicio.getTime());
    const ate = Math.min(fecha, fim.getTime());
    if (ate > de) totalMs += ate - de;
  }
  return totalMs / MS_POR_MINUTO;
}

/** Minutos corridos entre `inicio` e `fim` (0 se o fim não é depois do início). */
export function minutosCorridos(inicio: Date, fim: Date): number {
  return Math.max(0, (fim.getTime() - inicio.getTime()) / MS_POR_MINUTO);
}

export interface FaixaDeEspera {
  quantidade: number;
  /** 0–100, uma casa decimal. */
  percentual: number;
}

export interface ResumoDeEsperas {
  /** Quantos leads entraram na conta. */
  n: number;
  /** Média simples, em minutos (uma casa); `null` sem nenhum lead. */
  media: number | null;
  /** Mediana, em minutos (uma casa); `null` sem nenhum lead. */
  mediana: number | null;
  /** AC-786: as quatro faixas não se sobrepõem e somam `n`. */
  faixas: { ate1h: FaixaDeEspera; de1a4h: FaixaDeEspera; de4a24h: FaixaDeEspera; mais24h: FaixaDeEspera };
}

const arredondar = (valor: number) => Math.round(valor * 10) / 10;

/** AC-784/AC-786: média, mediana e faixas (até 1 h; 1 a 4 h; 4 a 24 h; mais de 24 h) de uma lista de esperas em minutos. */
export function resumirEsperas(minutos: number[]): ResumoDeEsperas {
  const n = minutos.length;
  const faixa = (quantidade: number): FaixaDeEspera => ({ quantidade, percentual: n > 0 ? arredondar((quantidade / n) * 100) : 0 });
  const conta = (teste: (m: number) => boolean) => minutos.filter(teste).length;

  const faixas = {
    ate1h: faixa(conta((m) => m <= 60)),
    de1a4h: faixa(conta((m) => m > 60 && m <= 240)),
    de4a24h: faixa(conta((m) => m > 240 && m <= 1440)),
    mais24h: faixa(conta((m) => m > 1440)),
  };
  if (n === 0) return { n, media: null, mediana: null, faixas };

  const ordenados = [...minutos].sort((a, b) => a - b);
  const meio = Math.floor(n / 2);
  const mediana = n % 2 === 1 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
  return { n, media: arredondar(minutos.reduce((soma, m) => soma + m, 0) / n), mediana: arredondar(mediana), faixas };
}
