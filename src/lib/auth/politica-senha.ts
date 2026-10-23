// T-141 (fase4-design-system-shell-acesso, US-105): política de senha única,
// decidida em Q-041 — 8+ caracteres, letra maiúscula, número ou símbolo —
// usada tanto pelo servidor (rotas de convite/redefinição, T-145) quanto
// pelas telas (`criterios-senha.tsx`, T-147), para que as duas nunca
// divirjam (AC-386). Módulo puro: sem I/O, sem conhecimento de token ou
// de banco.

export type IdCriterioSenha = 'comprimentoMinimo' | 'letraMaiuscula' | 'numeroOuSimbolo';

export interface CriterioSenha {
  id: IdCriterioSenha;
  descricao: string;
  atende: (senha: string) => boolean;
}

export interface CriterioSenhaAvaliado {
  id: IdCriterioSenha;
  descricao: string;
  atendido: boolean;
}

// Ordem e textos usados pelas telas (AC-367): "mínimo 8 caracteres, letra
// maiúscula, número ou símbolo".
export const CRITERIOS_SENHA: CriterioSenha[] = [
  {
    id: 'comprimentoMinimo',
    descricao: 'Mínimo de 8 caracteres',
    atende: (senha) => senha.length >= 8,
  },
  {
    id: 'letraMaiuscula',
    descricao: 'Uma letra maiúscula',
    atende: (senha) => /[A-Z]/.test(senha),
  },
  {
    id: 'numeroOuSimbolo',
    descricao: 'Um número ou símbolo',
    atende: (senha) => /[0-9]/.test(senha) || /[^A-Za-z0-9]/.test(senha),
  },
];

/** Avalia cada critério da política para a senha dada (uso pelas telas, AC-367/AC-386). */
export function avaliarSenha(senha: string): CriterioSenhaAvaliado[] {
  return CRITERIOS_SENHA.map((criterio) => ({
    id: criterio.id,
    descricao: criterio.descricao,
    atendido: criterio.atende(senha),
  }));
}

/** Diz se a senha atende a todos os critérios da política. */
export function senhaAtendePolitica(senha: string): boolean {
  return avaliarSenha(senha).every((criterio) => criterio.atendido);
}

export class ErroSenhaFraca extends Error {
  readonly codigo = 'SENHA_FRACA' as const;
  readonly criteriosNaoAtendidos: IdCriterioSenha[];

  constructor(criteriosNaoAtendidos: IdCriterioSenha[]) {
    super('Senha não atende à política exigida (mínimo 8 caracteres, letra maiúscula, número ou símbolo).');
    this.name = 'ErroSenhaFraca';
    this.criteriosNaoAtendidos = criteriosNaoAtendidos;
  }
}

/**
 * Recusa a senha que não atender à política (AC-385), com a lista dos
 * critérios não atendidos. Usada pelo servidor antes de consumir um token
 * de convite ou de redefinição.
 */
export function validarSenha(senha: string): void {
  const naoAtendidos = avaliarSenha(senha)
    .filter((criterio) => !criterio.atendido)
    .map((criterio) => criterio.id);

  if (naoAtendidos.length > 0) {
    throw new ErroSenhaFraca(naoAtendidos);
  }
}
