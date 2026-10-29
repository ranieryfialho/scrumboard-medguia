// T-224 (fase5-investimento-midia, ASM-216 a ASM-219): regras puras do investimento em mídia —
// validação do valor e do canal, chave do canal, rateio por dias e as razões CPL/CAC/ROAS.
export const VALOR_MINIMO = 0.01;
export const VALOR_MAXIMO = 9_999_999.99;

/** AC-629: de R$ 0,01 a R$ 9.999.999,99, com até duas casas. */
export function valorValido(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= VALOR_MINIMO && valor <= VALOR_MAXIMO && Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6;
}

/** AC-631: nome do canal sem espaços nas pontas, de 2 a 60 caracteres; `null` se inválido. */
export function normalizarCanal(nome: unknown): string | null {
  if (typeof nome !== 'string') return null;
  const limpo = nome.trim().replace(/\s+/g, ' ');
  return limpo.length >= 2 && limpo.length <= 60 ? limpo : null;
}

/** ASM-216: duas grafias que só diferem por maiúsculas ou espaços são o mesmo canal. */
export function chaveDoCanal(nome: string): string {
  return nome.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function mesValido(mes: unknown): mes is string {
  if (typeof mes !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return false;
  return Number(mes.slice(0, 4)) >= 2000;
}

export function diasDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

export interface LinhaDeInvestimento {
  /** Primeiro dia do mês, `YYYY-MM-DD`. */
  mes: string;
  canal: string;
  valor: number;
}

/**
 * ASM-218/AC-635: investimento do período (`de`/`ate` locais `YYYY-MM-DD`, inclusive) por canal —
 * cada mês entra com valor × (dias do mês dentro do período ÷ dias do mês).
 */
export function investimentoDoPeriodo(linhas: LinhaDeInvestimento[], de: string, ate: string): Map<string, { canal: string; valor: number }> {
  const porCanal = new Map<string, { canal: string; valor: number }>();
  const inicio = Date.parse(`${de}T00:00:00Z`);
  const fim = Date.parse(`${ate}T00:00:00Z`);
  for (const l of linhas) {
    const ano = Number(l.mes.slice(0, 4));
    const mes = Number(l.mes.slice(5, 7));
    const total = diasDoMes(ano, mes);
    const primeiro = Date.UTC(ano, mes - 1, 1);
    const ultimo = Date.UTC(ano, mes - 1, total);
    const dentro = Math.max(0, (Math.min(fim, ultimo) - Math.max(inicio, primeiro)) / 86_400_000 + 1);
    if (dentro <= 0) continue;
    const chave = chaveDoCanal(l.canal);
    const atual = porCanal.get(chave) ?? { canal: l.canal, valor: 0 };
    atual.valor += l.valor * (dentro / total);
    porCanal.set(chave, atual);
  }
  for (const v of porCanal.values()) v.valor = Math.round(v.valor * 100) / 100;
  return porCanal;
}

/** AC-638: divisão por zero (ou sem base) vira `null`, que a tela mostra como "—". */
export function razao(numerador: number, denominador: number): number | null {
  return denominador > 0 ? numerador / denominador : null;
}
