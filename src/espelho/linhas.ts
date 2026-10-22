// T-132 (fase3-espelho-sheets, US-094/US-095): monta as linhas da aba
// "Espelho CRM" a partir dos cards já lidos do banco (T-133 cuida da
// consulta; este módulo é puro, sem I/O). Cabeçalho fixo + uma linha por
// card (AC-329). Cadência fica em branco quando o card não tem cadência
// (AC-330). Datas são formatadas em `America/Sao_Paulo` (ASM-113).
//
// AC-335: células de texto que começam com `=`, `+`, `-` ou `@` recebem o
// prefixo `'` — é assim que o Google Sheets aceita gravar um valor que
// pareceria fórmula como texto literal, sem executá-lo.

export type Turno = 'manha' | 'tarde';

export interface CadenciaDoCard {
  dia: 1 | 2 | 3;
  turno: Turno;
  tentativas: number;
  proximaAcaoEm: Date | null;
}

export interface CardEspelho {
  nome: string;
  telefone: string | null;
  email: string | null;
  etapa: string;
  responsavel: string | null;
  valor: number | null;
  motivoPerda: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
  cadencia: CadenciaDoCard | null;
}

export const CABECALHO_ESPELHO: readonly string[] = [
  'nome',
  'telefone',
  'e-mail',
  'etapa',
  'responsável',
  'valor',
  'motivo de perda',
  'criado em',
  'atualizado em',
  'dia da cadência',
  'turno',
  'tentativas',
  'próxima ação',
];

const FUSO_SAO_PAULO = 'America/Sao_Paulo';

const REGEX_PARECE_FORMULA = /^[=+\-@]/;

/** AC-335: protege texto que pareceria fórmula para o Sheets, prefixando com `'`. */
export function protegerContraFormula(texto: string): string {
  return REGEX_PARECE_FORMULA.test(texto) ? `'${texto}` : texto;
}

function formatarDataHora(instante: Date): string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_SAO_PAULO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);

  const valorDe = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? '';

  return `${valorDe('day')}/${valorDe('month')}/${valorDe('year')} ${valorDe('hour')}:${valorDe('minute')}`;
}

function celulaTexto(valor: string | null | undefined): string {
  if (valor == null || valor === '') return '';
  return protegerContraFormula(valor);
}

function celulaData(instante: Date | null | undefined): string {
  if (!instante) return '';
  return formatarDataHora(instante);
}

/**
 * Monta a linha de um card para a aba "Espelho CRM" (AC-329). Colunas de
 * cadência (dia, turno, tentativas, próxima ação) ficam em branco quando o
 * card não está em cadência (AC-330).
 */
export function montarLinhaDoCard(card: CardEspelho): string[] {
  const cadencia = card.cadencia;

  return [
    celulaTexto(card.nome),
    celulaTexto(card.telefone),
    celulaTexto(card.email),
    celulaTexto(card.etapa),
    celulaTexto(card.responsavel),
    card.valor == null ? '' : String(card.valor),
    celulaTexto(card.motivoPerda),
    celulaData(card.criadoEm),
    celulaData(card.atualizadoEm),
    cadencia ? String(cadencia.dia) : '',
    cadencia ? cadencia.turno : '',
    cadencia ? String(cadencia.tentativas) : '',
    cadencia ? celulaData(cadencia.proximaAcaoEm) : '',
  ];
}

/** Monta a aba inteira (cabeçalho + uma linha por card), na ordem recebida. */
export function montarLinhasDoEspelho(cards: CardEspelho[]): string[][] {
  return [[...CABECALHO_ESPELHO], ...cards.map(montarLinhaDoCard)];
}
