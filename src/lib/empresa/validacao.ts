// T-235 (fase5-empresa-dados, AC-651/AC-652): validação e normalização dos dados cadastrais da empresa
// — CNPJ pelos dígitos verificadores, CEP, UF, plano e assentos. Funções puras, sem banco.
export const PLANOS = ['starter', 'clinica', 'enterprise'] as const;
export type Plano = (typeof PLANOS)[number];
export const ROTULO_DO_PLANO: Record<Plano, string> = { starter: 'Starter', clinica: 'Clínica', enterprise: 'Enterprise' };

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export const ASSENTOS_MINIMO = 1;
export const ASSENTOS_MAXIMO = 9999;

export function soDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

/** AC-652: 14 dígitos com os dois dígitos verificadores certos; sequências repetidas (000…, 111…) não valem. */
export function cnpjValido(entrada: string): boolean {
  const cnpj = soDigitos(entrada);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digito = (tamanho: number) => {
    const pesos = tamanho === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + Number(cnpj[i]) * p, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === Number(cnpj[12]) && digito(13) === Number(cnpj[13]);
}

export interface DadosDaEmpresa {
  razaoSocial: string | null;
  cnpj: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  plano: Plano | null;
  assentos: number | null;
}

export type ResultadoDaValidacao = { ok: true; dados: Partial<DadosDaEmpresa> } | { ok: false; campo: string; mensagem: string };

const CAMPOS_DE_TEXTO: Array<[keyof DadosDaEmpresa, number, string]> = [
  ['logradouro', 120, 'O logradouro deve ter até 120 caracteres.'],
  ['numero', 20, 'O número deve ter até 20 caracteres.'],
  ['complemento', 60, 'O complemento deve ter até 60 caracteres.'],
  ['bairro', 60, 'O bairro deve ter até 60 caracteres.'],
  ['cidade', 80, 'A cidade deve ter até 80 caracteres.'],
];

/**
 * Valida só os campos presentes em `corpo` (edição) ou, com `completo`, exige razão social, CNPJ,
 * plano e assentos (criação). Campo vazio vira `null`. Se qualquer parte do endereço vier, exige
 * CEP, logradouro, número, cidade e UF (AC-651).
 */
export function validarDadosDaEmpresa(corpo: Record<string, unknown>, opcoes: { completo: boolean }): ResultadoDaValidacao {
  const recusa = (campo: string, mensagem: string) => ({ ok: false as const, campo, mensagem });
  const dados: Partial<DadosDaEmpresa> = {};
  const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : v);
  const presente = (campo: string) => corpo[campo] !== undefined;

  if (opcoes.completo) {
    for (const [campo, mensagem] of [['razaoSocial', 'Informe a razão social.'], ['cnpj', 'Informe o CNPJ.'], ['plano', 'Escolha o plano.'], ['assentos', 'Informe o número de assentos.']] as const) {
      if (corpo[campo] === undefined || corpo[campo] === null || corpo[campo] === '') return recusa(campo, mensagem);
    }
  }

  if (presente('razaoSocial')) {
    const v = texto(corpo.razaoSocial);
    if (v === null || v === '') {
      if (opcoes.completo) return recusa('razaoSocial', 'Informe a razão social.');
      dados.razaoSocial = null;
    } else if (typeof v !== 'string' || v.length < 2 || v.length > 150) return recusa('razaoSocial', 'A razão social deve ter de 2 a 150 caracteres.');
    else dados.razaoSocial = v;
  }
  if (presente('cnpj')) {
    const v = texto(corpo.cnpj);
    if (v === null || v === '') dados.cnpj = null;
    else if (typeof v !== 'string' || !cnpjValido(v)) return recusa('cnpj', 'O CNPJ é inválido.');
    else dados.cnpj = soDigitos(v);
  }
  if (presente('plano')) {
    const v = corpo.plano;
    if (v === null || v === '') dados.plano = null;
    else if (typeof v !== 'string' || !(PLANOS as readonly string[]).includes(v)) return recusa('plano', 'Escolha Starter, Clínica ou Enterprise.');
    else dados.plano = v as Plano;
  }
  if (presente('assentos')) {
    const v = corpo.assentos;
    if (v === null || v === '') dados.assentos = null;
    else if (typeof v !== 'number' || !Number.isInteger(v) || v < ASSENTOS_MINIMO || v > ASSENTOS_MAXIMO) return recusa('assentos', `Os assentos devem ser um número inteiro de ${ASSENTOS_MINIMO} a ${ASSENTOS_MAXIMO}.`);
    else dados.assentos = v;
  }
  if (presente('cep')) {
    const v = texto(corpo.cep);
    if (v === null || v === '') dados.cep = null;
    else if (typeof v !== 'string' || soDigitos(v).length !== 8) return recusa('cep', 'O CEP deve ter 8 dígitos.');
    else dados.cep = soDigitos(v);
  }
  if (presente('uf')) {
    const v = texto(corpo.uf);
    if (v === null || v === '') dados.uf = null;
    else if (typeof v !== 'string' || !UFS.includes(v.toUpperCase())) return recusa('uf', 'A UF é inválida.');
    else dados.uf = v.toUpperCase();
  }
  for (const [campo, maximo, mensagem] of CAMPOS_DE_TEXTO) {
    if (!presente(campo)) continue;
    const v = texto(corpo[campo]);
    if (v === null || v === '') (dados as Record<string, unknown>)[campo] = null;
    else if (typeof v !== 'string' || v.length > maximo) return recusa(campo, mensagem);
    else (dados as Record<string, unknown>)[campo] = v;
  }

  // endereço: se qualquer parte veio preenchida (na criação), as obrigatórias precisam vir
  if (opcoes.completo && ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'complemento'].some((c) => dados[c as keyof DadosDaEmpresa])) {
    for (const [campo, mensagem] of [['cep', 'Informe o CEP.'], ['logradouro', 'Informe o logradouro.'], ['numero', 'Informe o número.'], ['cidade', 'Informe a cidade.'], ['uf', 'Informe a UF.']] as const) {
      if (!dados[campo]) return recusa(campo, mensagem);
    }
  }
  return { ok: true, dados };
}
