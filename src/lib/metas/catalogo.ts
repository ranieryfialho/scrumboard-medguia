// T-219 (fase5-metas, ASM-211/ASM-214): as cinco metas que o CRM sabe cadastrar — todas em
// porcentagem, onde "mais é melhor" — e a regra de "meta atingida" usada pelas telas.
export const CHAVES_METAS = ['taxa_conversao', 'taxa_presenca', 'taxa_entrega_email', 'taxa_abertura_email', 'taxa_cliques_email'] as const;
export type ChaveMeta = (typeof CHAVES_METAS)[number];

export interface DefinicaoMeta {
  chave: ChaveMeta;
  area: 'Pipeline' | 'Agenda' | 'E-mail';
  rotulo: string;
  ajuda: string;
}

export const CATALOGO_METAS: DefinicaoMeta[] = [
  { chave: 'taxa_conversao', area: 'Pipeline', rotulo: 'Taxa de conversão', ajuda: 'Ganhos ÷ (ganhos + perdas). Vale para o funil e o win rate do relatório comercial.' },
  { chave: 'taxa_presenca', area: 'Agenda', rotulo: 'Taxa de presença', ajuda: 'Reuniões realizadas ÷ (realizadas + no-show) na semana.' },
  { chave: 'taxa_entrega_email', area: 'E-mail', rotulo: 'Taxa de entrega de e-mail', ajuda: 'Enviados sem falha de uma campanha.' },
  { chave: 'taxa_abertura_email', area: 'E-mail', rotulo: 'Taxa de abertura de e-mail', ajuda: 'Abertura única de uma campanha.' },
  { chave: 'taxa_cliques_email', area: 'E-mail', rotulo: 'Taxa de cliques de e-mail', ajuda: 'Cliques únicos de uma campanha.' },
];

export type MetasDaEmpresa = Partial<Record<ChaveMeta, number>>;

export function ehChaveMeta(chave: string): chave is ChaveMeta {
  return (CHAVES_METAS as readonly string[]).includes(chave);
}

/** AC-617: de 0,1 a 100, com no máximo uma casa decimal. */
export function metaValida(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0.1 && valor <= 100 && Math.abs(valor * 10 - Math.round(valor * 10)) < 1e-9;
}

export interface SeloMeta {
  texto: string;
  atingida: boolean;
}

/** AC-625: sem meta ou sem valor (null) não há selo; AC-623: igualdade conta como atingida. */
export function descreverMeta(valorPercentual: number | null | undefined, alvo: number | undefined): SeloMeta | null {
  if (alvo === undefined || valorPercentual === null || valorPercentual === undefined) return null;
  return { texto: `Meta ${alvo.toLocaleString('pt-BR')}%`, atingida: valorPercentual >= alvo };
}
