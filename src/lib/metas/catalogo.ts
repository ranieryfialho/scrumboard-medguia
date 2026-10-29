// T-219 (fase5-metas, ASM-211/ASM-214): as metas que o CRM sabe cadastrar — onde "mais é melhor" — e a regra de
// "meta atingida" usada pelas telas. Cinco são em porcentagem; fase5-meta-receita (ASM-252) acrescenta a receita
// mensal, em reais.
export const CHAVES_METAS = ['taxa_conversao', 'taxa_presenca', 'taxa_entrega_email', 'taxa_abertura_email', 'taxa_cliques_email', 'receita_mensal'] as const;
export type ChaveMeta = (typeof CHAVES_METAS)[number];

export type UnidadeMeta = 'porcentagem' | 'reais';

export interface DefinicaoMeta {
  chave: ChaveMeta;
  area: 'Pipeline' | 'Agenda' | 'E-mail' | 'Comercial';
  unidade: UnidadeMeta;
  rotulo: string;
  ajuda: string;
}

export const CATALOGO_METAS: DefinicaoMeta[] = [
  { chave: 'taxa_conversao', unidade: 'porcentagem', area: 'Pipeline', rotulo: 'Taxa de conversão', ajuda: 'Ganhos ÷ (ganhos + perdas). Vale para o funil e o win rate do relatório comercial.' },
  { chave: 'taxa_presenca', unidade: 'porcentagem', area: 'Agenda', rotulo: 'Taxa de presença', ajuda: 'Reuniões realizadas ÷ (realizadas + no-show) na semana.' },
  { chave: 'taxa_entrega_email', unidade: 'porcentagem', area: 'E-mail', rotulo: 'Taxa de entrega de e-mail', ajuda: 'Enviados sem falha de uma campanha.' },
  { chave: 'taxa_abertura_email', unidade: 'porcentagem', area: 'E-mail', rotulo: 'Taxa de abertura de e-mail', ajuda: 'Abertura única de uma campanha.' },
  { chave: 'taxa_cliques_email', unidade: 'porcentagem', area: 'E-mail', rotulo: 'Taxa de cliques de e-mail', ajuda: 'Cliques únicos de uma campanha.' },
  { chave: 'receita_mensal', unidade: 'reais', area: 'Comercial', rotulo: 'Receita mensal (Novo MRR)', ajuda: 'Quanto contratar de Novo MRR por mês. O selo aparece no relatório comercial quando o período é um mês inteiro.' },
];

export const unidadeDaMeta = (chave: ChaveMeta): UnidadeMeta => CATALOGO_METAS.find((m) => m.chave === chave)!.unidade;

export type MetasDaEmpresa = Partial<Record<ChaveMeta, number>>;

export function ehChaveMeta(chave: string): chave is ChaveMeta {
  return (CHAVES_METAS as readonly string[]).includes(chave);
}

export const RECEITA_MINIMA = 0.01;
export const RECEITA_MAXIMA = 99_999_999.99;

/**
 * AC-617/AC-688: porcentagem de 0,1 a 100 com uma casa; receita de R$ 0,01 a R$ 99.999.999,99 com até duas casas.
 * A unidade vem da chave: 5000 vale para a receita e não para uma taxa.
 */
export function metaValida(chave: ChaveMeta, valor: unknown): valor is number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return false;
  if (unidadeDaMeta(chave) === 'reais') return valor >= RECEITA_MINIMA && valor <= RECEITA_MAXIMA && Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6;
  return valor >= 0.1 && valor <= 100 && Math.abs(valor * 10 - Math.round(valor * 10)) < 1e-9;
}

/** AC-692: do dia 1 ao último dia do mesmo mês (datas locais `YYYY-MM-DD`; datas inválidas não valem). */
export function ehMesInteiro(de: string, ate: string): boolean {
  const lido = (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) return null;
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia ? { ano, mes, dia } : null;
  };
  const inicio = lido(de);
  const fim = lido(ate);
  if (!inicio || !fim) return false;
  const ultimoDia = new Date(Date.UTC(inicio.ano, inicio.mes, 0)).getUTCDate();
  return inicio.dia === 1 && fim.ano === inicio.ano && fim.mes === inicio.mes && fim.dia === ultimoDia;
}

export interface SeloMeta {
  texto: string;
  atingida: boolean;
}

/** AC-625: sem meta ou sem valor (null) não há selo; AC-623: igualdade conta como atingida. */
export function descreverMeta(valor: number | null | undefined, alvo: number | undefined, unidade: UnidadeMeta = 'porcentagem'): SeloMeta | null {
  if (alvo === undefined || valor === null || valor === undefined) return null;
  return { texto: `Meta ${formatarAlvo(alvo, unidade)}`, atingida: valor >= alvo };
}

/** "25%" ou "R$ 50.000" (centavos só quando existem). */
export function formatarAlvo(alvo: number, unidade: UnidadeMeta): string {
  if (unidade === 'porcentagem') return `${alvo.toLocaleString('pt-BR')}%`;
  const casas = Number.isInteger(alvo) ? 0 : 2;
  return alvo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas });
}
