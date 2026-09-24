// T-033 (fase1-auth-rbac, US-020): rate limit de tentativas de login, convite
// e reset por e-mail e por IP. Fica em memória de processo (sem tabela nova):
// `login.ts`/`convites.ts`/`reset-senha.ts` chamariam `verificar` antes de
// processar a tentativa e `registrarFalha` quando ela falhar. Limite e
// janela exatos dependem de Q-005 (spec, em aberto); os defaults abaixo são
// o "razoável documentado" até a resposta.
export const LIMITE_PADRAO_TENTATIVAS = 5;
export const JANELA_PADRAO_MS = 15 * 60 * 1000; // 15 minutos

export class ErroLimiteTaxaExcedido extends Error {
  /** Quanto falta, em ms, até a tentativa mais antiga da janela expirar. */
  readonly tentarNovamenteEmMs: number;

  constructor(tentarNovamenteEmMs: number) {
    super('Limite de tentativas excedido. Tente novamente mais tarde.');
    this.name = 'ErroLimiteTaxaExcedido';
    this.tentarNovamenteEmMs = tentarNovamenteEmMs;
  }
}

export interface LimitadorTaxaOpcoes {
  limite?: number;
  janelaMs?: number;
  agora?: () => Date;
}

/**
 * Limitador de taxa por chave (e-mail ou IP), em memória. Guarda apenas os
 * instantes das tentativas malsucedidas dentro da janela; tentativas fora da
 * janela são descartadas na próxima leitura/escrita da mesma chave.
 */
export class LimitadorTaxa {
  private readonly falhasPorChave = new Map<string, number[]>();
  private readonly limite: number;
  private readonly janelaMs: number;
  private readonly agora: () => Date;

  constructor(opcoes: LimitadorTaxaOpcoes = {}) {
    this.limite = opcoes.limite ?? LIMITE_PADRAO_TENTATIVAS;
    this.janelaMs = opcoes.janelaMs ?? JANELA_PADRAO_MS;
    this.agora = opcoes.agora ?? (() => new Date());
  }

  private falhasNaJanela(chave: string): number[] {
    const agoraMs = this.agora().getTime();
    const inicioJanela = agoraMs - this.janelaMs;
    const todas = this.falhasPorChave.get(chave) ?? [];
    const validas = todas.filter((instante) => instante > inicioJanela);

    if (validas.length !== todas.length) {
      if (validas.length === 0) {
        this.falhasPorChave.delete(chave);
      } else {
        this.falhasPorChave.set(chave, validas);
      }
    }

    return validas;
  }

  /**
   * Recusa a tentativa (AC-047) se `chave` já acumulou `limite` falhas
   * dentro da janela — mesmo que a tentativa atual traga credenciais
   * corretas, quem chama deve invocar isto antes de validar credenciais.
   */
  verificar(chave: string): void {
    const falhas = this.falhasNaJanela(chave);
    if (falhas.length >= this.limite) {
      const maisAntiga = Math.min(...falhas);
      const tentarNovamenteEmMs = maisAntiga + this.janelaMs - this.agora().getTime();
      throw new ErroLimiteTaxaExcedido(Math.max(tentarNovamenteEmMs, 0));
    }
  }

  /** Registra mais uma tentativa malsucedida para `chave`. */
  registrarFalha(chave: string): void {
    const falhas = this.falhasNaJanela(chave);
    falhas.push(this.agora().getTime());
    this.falhasPorChave.set(chave, falhas);
  }

  /** Limpa o histórico de falhas de `chave` (ex.: após uma tentativa bem-sucedida). */
  registrarSucesso(chave: string): void {
    this.falhasPorChave.delete(chave);
  }
}

export type OperacaoLimitada = 'login' | 'convite' | 'reset';

/** Convenção de chave por e-mail, isolada por operação (US-020: login/convite/reset). */
export function chavePorEmail(operacao: OperacaoLimitada, email: string): string {
  return `${operacao}:email:${email}`;
}

/** Convenção de chave por IP, isolada por operação (US-020: login/convite/reset). */
export function chavePorIp(operacao: OperacaoLimitada, ip: string): string {
  return `${operacao}:ip:${ip}`;
}

/**
 * Verifica o limite de `operacao` para e-mail e IP juntos (AC-047: "para o
 * mesmo e-mail ou IP") — recusa se qualquer um dos dois já excedeu.
 */
export function verificarLimite(
  limitador: LimitadorTaxa,
  operacao: OperacaoLimitada,
  email: string,
  ip: string
): void {
  limitador.verificar(chavePorEmail(operacao, email));
  limitador.verificar(chavePorIp(operacao, ip));
}

/** Registra falha de `operacao` tanto na chave de e-mail quanto na de IP. */
export function registrarFalha(
  limitador: LimitadorTaxa,
  operacao: OperacaoLimitada,
  email: string,
  ip: string
): void {
  limitador.registrarFalha(chavePorEmail(operacao, email));
  limitador.registrarFalha(chavePorIp(operacao, ip));
}

/** Limpa o histórico de falhas de `operacao` para e-mail e IP juntos. */
export function registrarSucesso(
  limitador: LimitadorTaxa,
  operacao: OperacaoLimitada,
  email: string,
  ip: string
): void {
  limitador.registrarSucesso(chavePorEmail(operacao, email));
  limitador.registrarSucesso(chavePorIp(operacao, ip));
}
