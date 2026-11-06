// Regra do selo "Novo" no card da Entrada de leads.
//
// - Lead que chega de segunda a sexta: o selo dura 12 horas.
// - Lead que chega no sábado ou domingo: o selo dura até 48 horas, mas nunca passa
//   da virada para segunda-feira (00:00) — assim o selo do fim de semana "encolhe"
//   conforme a segunda se aproxima e a segunda começa limpa, só com os leads dela.
//
// O dia da semana é o do horário de Brasília (a operação é daqui), não o do servidor.

const FUSO = 'America/Sao_Paulo';
const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

export const DURACAO_SEMANA_MS = 12 * HORA_MS;
export const DURACAO_FIM_DE_SEMANA_MS = 48 * HORA_MS;

const formatador = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

function partesNoFuso(data: Date): { diaDaSemana: string; msDesdeMeiaNoite: number } {
  const partes = Object.fromEntries(formatador.formatToParts(data).map((p) => [p.type, p.value]));
  const msDesdeMeiaNoite =
    (Number(partes.hour) * 3600 + Number(partes.minute) * 60 + Number(partes.second)) * 1000;
  return { diaDaSemana: partes.weekday, msDesdeMeiaNoite };
}

/** Quanto tempo o selo "Novo" fica no ar para um lead criado em `criadoEm`, em milissegundos. */
export function duracaoDoSeloNovoMs(criadoEm: Date): number {
  const { diaDaSemana, msDesdeMeiaNoite } = partesNoFuso(criadoEm);

  const diasAteSegunda = diaDaSemana === 'Sat' ? 2 : diaDaSemana === 'Sun' ? 1 : 0;
  if (diasAteSegunda === 0) return DURACAO_SEMANA_MS;

  const ateSegunda = diasAteSegunda * DIA_MS - msDesdeMeiaNoite;
  return Math.min(DURACAO_FIM_DE_SEMANA_MS, ateSegunda);
}

/** O card deve mostrar o selo "Novo" neste momento? */
export function leadEhNovo(criadoEm: Date | string | null | undefined, agora: Date): boolean {
  if (!criadoEm) return false;
  const data = criadoEm instanceof Date ? criadoEm : new Date(criadoEm);
  if (Number.isNaN(data.getTime())) return false;

  const decorrido = agora.getTime() - data.getTime();
  return decorrido >= 0 && decorrido < duracaoDoSeloNovoMs(data);
}
