// fase6-qualificacao-comercial (US-198, AC-830/AC-833): domínio puro (sem I/O) da qualificação comercial do card. Seis critérios
// pontuados somam 0 a 100; três eliminatórios prevalecem sobre a nota. Os pesos, as opções e os cortes (80/60/40) vêm do simulador
// do dono do produto e são hipóteses comerciais (ASM-319): ficam aqui, num só lugar, para ajustar sem mexer em tela nem em banco.

export const CHAVES_DOS_CRITERIOS = ['dor', 'complexidade', 'decisao', 'gatilho', 'abertura', 'aderencia'] as const;
export type ChaveDoCriterio = (typeof CHAVES_DOS_CRITERIOS)[number];

export interface CriterioDeQualificacao {
  chave: ChaveDoCriterio;
  nome: string;
  max: number;
  dica: string;
  opcoes: { rotulo: string; pontos: number }[];
}

export const CRITERIOS: readonly CriterioDeQualificacao[] = [
  { chave: 'dor', nome: 'Dor operacional', max: 25, dica: 'A necessidade é real, recorrente e reconhecida?', opcoes: [
    { rotulo: 'Não identificada', pontos: 0 }, { rotulo: 'Leve ou genérica', pontos: 10 }, { rotulo: 'Clara e recorrente', pontos: 20 }, { rotulo: 'Crítica e reconhecida', pontos: 25 },
  ] },
  { chave: 'complexidade', nome: 'Complexidade da operação', max: 20, dica: 'Qual a intensidade dos processos, equipe e acompanhamento?', opcoes: [
    { rotulo: 'Baixa', pontos: 0 }, { rotulo: 'Moderada', pontos: 10 }, { rotulo: 'Alta', pontos: 20 },
  ] },
  { chave: 'decisao', nome: 'Poder de decisão', max: 15, dica: 'O contato pode aprovar a contratação?', opcoes: [
    { rotulo: 'Sem acesso ao decisor', pontos: 0 }, { rotulo: 'Influenciador com acesso', pontos: 10 }, { rotulo: 'Decisor envolvido', pontos: 15 },
  ] },
  { chave: 'gatilho', nome: 'Gatilho e urgência', max: 15, dica: 'Há um motivo concreto para agir agora?', opcoes: [
    { rotulo: 'Sem gatilho identificado', pontos: 0 }, { rotulo: 'Interesse sem prazo', pontos: 5 }, { rotulo: 'Mudança planejada', pontos: 10 }, { rotulo: 'Necessidade imediata', pontos: 15 },
  ] },
  { chave: 'abertura', nome: 'Abertura para adoção', max: 15, dica: 'O médico e a equipe aceitariam implantar a solução?', opcoes: [
    { rotulo: 'Resistência forte', pontos: 0 }, { rotulo: 'Aberto a conhecer', pontos: 5 }, { rotulo: 'Disposto a testar', pontos: 10 }, { rotulo: 'Comprometido com implantação', pontos: 15 },
  ] },
  { chave: 'aderencia', nome: 'Aderência à solução', max: 10, dica: 'O produto atende ao que é essencial para a operação?', opcoes: [
    { rotulo: 'Baixa ou incompatível', pontos: 0 }, { rotulo: 'Parcial', pontos: 5 }, { rotulo: 'Alta', pontos: 10 },
  ] },
];

export const CHAVES_DOS_BLOQUEIOS = ['necessidade', 'decisor', 'exigencia'] as const;
export type ChaveDoBloqueio = (typeof CHAVES_DOS_BLOQUEIOS)[number];

export const BLOQUEIOS: readonly { chave: ChaveDoBloqueio; rotulo: string }[] = [
  { chave: 'necessidade', rotulo: 'Necessidade obrigatória não atendida pelo produto' },
  { chave: 'decisor', rotulo: 'Impossibilidade de contratar ou acessar um decisor' },
  { chave: 'exigencia', rotulo: 'Exigência técnica ou comercial incompatível' },
];

export const CHAVES_DOS_ESTAGIOS = ['residente', 'inicio', 'operacao', 'crescimento', 'migracao'] as const;
export type ChaveDoEstagio = (typeof CHAVES_DOS_ESTAGIOS)[number];

export const ESTAGIOS: readonly { chave: ChaveDoEstagio; rotulo: string; jornada: string }[] = [
  { chave: 'residente', rotulo: 'Residente finalista, preparando consultório', jornada: 'ICP R · Residente finalista (relacionamento e preparação)' },
  { chave: 'inicio', rotulo: 'Consultório em implantação ou início', jornada: 'Implantação de consultório' },
  { chave: 'operacao', rotulo: 'Consultório em operação', jornada: 'Consultório em operação' },
  { chave: 'crescimento', rotulo: 'Consultório em crescimento', jornada: 'Crescimento' },
  { chave: 'migracao', rotulo: 'Em avaliação de troca de sistema', jornada: 'Migração de sistema' },
];

/** Respostas de um critério: os pontos escolhidos; `null` = ainda não respondido (vale 0 na soma). */
export type RespostasDaQualificacao = Record<ChaveDoCriterio, number | null>;

export interface EntradaDaQualificacao {
  respostas: RespostasDaQualificacao;
  bloqueios: ChaveDoBloqueio[];
  estagio: ChaveDoEstagio | null;
}

export type FaixaDeQualificacao = 'A' | 'B' | 'C' | 'baixo' | 'revisao';
export const FAIXAS_DE_QUALIFICACAO: readonly FaixaDeQualificacao[] = ['A', 'B', 'C', 'baixo', 'revisao'];

export interface ResultadoDaQualificacao {
  /** 0 a 100 (soma dos pontos escolhidos). */
  score: number;
  /** `null` = avaliação não iniciada (sem respostas e sem eliminatório). */
  faixa: FaixaDeQualificacao | null;
  rotulo: string;
  titulo: string;
  recomendacao: string;
  jornada: string;
}

export const TEXTO_NAO_INICIADA = {
  rotulo: 'Avaliação não iniciada',
  titulo: 'Preencha os critérios',
  recomendacao: 'A classificação será calculada automaticamente conforme as respostas. Pontuação zero sem respostas não representa baixo fit.',
};

const TEXTOS: Record<FaixaDeQualificacao, { rotulo: string; titulo: string; recomendacao: string }> = {
  revisao: {
    rotulo: 'Revisão obrigatória',
    titulo: 'Critério eliminatório identificado',
    recomendacao: 'Suspender o avanço automático. Confirmar a incompatibilidade e avaliar desqualificação ou exceção documentada.',
  },
  A: { rotulo: 'Alta prioridade · Faixa A', titulo: 'Priorizar atendimento', recomendacao: 'Conduzir diagnóstico consultivo, demonstração personalizada e follow-up ativo com próximo passo definido.' },
  B: { rotulo: 'Qualificado · Faixa B', titulo: 'Aprofundar a oportunidade', recomendacao: 'Explorar objeções, confirmar interesse e avançar para demonstração conforme a dor identificada.' },
  C: { rotulo: 'Nutrição · Faixa C', titulo: 'Desenvolver relacionamento', recomendacao: 'Registrar a dor, manter nutrição e acompanhar gatilhos de mudança. Baixa urgência não equivale a Anti-ICP.' },
  baixo: { rotulo: 'Baixo fit', titulo: 'Baixa prioridade', recomendacao: 'Evitar esforço comercial intensivo. Investigar a necessidade antes de avançar ou desqualificar.' },
};

/** Rótulo curto da faixa, para selos e filtros. */
export const ROTULO_CURTO_DA_FAIXA: Record<FaixaDeQualificacao, string> = { A: 'Faixa A', B: 'Faixa B', C: 'Faixa C', baixo: 'Baixo fit', revisao: 'Revisão' };

export const RESPOSTAS_VAZIAS: RespostasDaQualificacao = { dor: null, complexidade: null, decisao: null, gatilho: null, abertura: null, aderencia: null };

export function jornadaDoEstagio(estagio: ChaveDoEstagio | null): string {
  return ESTAGIOS.find((e) => e.chave === estagio)?.jornada ?? 'não identificada';
}

/** AC-830: a faixa de uma nota (sem considerar eliminatório). */
export function faixaDaNota(score: number): FaixaDeQualificacao {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'baixo';
}

/** AC-830/AC-833: soma os pontos, aplica o eliminatório e devolve faixa, textos e jornada. */
export function calcularQualificacao(entrada: EntradaDaQualificacao): ResultadoDaQualificacao {
  const score = CHAVES_DOS_CRITERIOS.reduce((soma, chave) => soma + (entrada.respostas[chave] ?? 0), 0);
  const respondeu = CHAVES_DOS_CRITERIOS.some((chave) => entrada.respostas[chave] !== null);
  const bloqueado = entrada.bloqueios.length > 0;
  const jornada = jornadaDoEstagio(entrada.estagio);

  if (!respondeu && !bloqueado) return { score, faixa: null, ...TEXTO_NAO_INICIADA, jornada };
  const faixa: FaixaDeQualificacao = bloqueado ? 'revisao' : faixaDaNota(score);
  return { score, faixa, ...TEXTOS[faixa], jornada };
}

export type ResultadoDaValidacao = { ok: true; entrada: EntradaDaQualificacao } | { ok: false; campo: string };

/**
 * AC-831: confere um corpo vindo de fora. Cada resposta precisa ser uma pontuação que existe no critério (ou `null`), os
 * eliminatórios e o estágio precisam ser conhecidos. Só devolve campos conhecidos; critério ausente conta como não respondido.
 */
export function validarEntrada(corpo: unknown): ResultadoDaValidacao {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) return { ok: false, campo: 'corpo' };
  const bruto = corpo as Record<string, unknown>;

  const respostasBrutas = bruto.respostas ?? {};
  if (typeof respostasBrutas !== 'object' || respostasBrutas === null || Array.isArray(respostasBrutas)) return { ok: false, campo: 'respostas' };
  const respostas = { ...RESPOSTAS_VAZIAS };
  for (const criterio of CRITERIOS) {
    const valor = (respostasBrutas as Record<string, unknown>)[criterio.chave];
    if (valor === undefined || valor === null) continue;
    if (typeof valor !== 'number' || !criterio.opcoes.some((o) => o.pontos === valor)) return { ok: false, campo: criterio.chave };
    respostas[criterio.chave] = valor;
  }

  const bloqueiosBrutos = bruto.bloqueios ?? [];
  if (!Array.isArray(bloqueiosBrutos)) return { ok: false, campo: 'bloqueios' };
  const bloqueios: ChaveDoBloqueio[] = [];
  for (const item of bloqueiosBrutos) {
    if (!(CHAVES_DOS_BLOQUEIOS as readonly unknown[]).includes(item)) return { ok: false, campo: 'bloqueios' };
    if (!bloqueios.includes(item as ChaveDoBloqueio)) bloqueios.push(item as ChaveDoBloqueio);
  }

  const estagioBruto = bruto.estagio ?? null;
  if (estagioBruto !== null && !(CHAVES_DOS_ESTAGIOS as readonly unknown[]).includes(estagioBruto)) return { ok: false, campo: 'estagio' };

  return { ok: true, entrada: { respostas, bloqueios, estagio: estagioBruto as ChaveDoEstagio | null } };
}

/** AC-835: o filtro da lista — uma faixa ou "nenhuma" (cards sem avaliação). */
export type FiltroDeQualificacao = FaixaDeQualificacao | 'nenhuma';

/** Lê o parâmetro `qualificacao` da consulta; valor desconhecido vira `undefined` (sem filtro). */
export function lerFiltroDeQualificacao(valor: string | null | undefined): FiltroDeQualificacao | undefined {
  if (valor === 'nenhuma') return 'nenhuma';
  return (FAIXAS_DE_QUALIFICACAO as readonly string[]).includes(valor ?? '') ? (valor as FaixaDeQualificacao) : undefined;
}
