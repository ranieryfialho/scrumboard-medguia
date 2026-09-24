// T-030 (fase1-auth-rbac, US-017): reset de senha por e-mail. Reaproveita o
// formato de hash de T-029 (`hashSenha`) e o mesmo padrão de token de uso
// único em `tokens_verificacao` de T-028/T-029, com identificador
// `reset:<email>` (em vez de `convite:<email>`) para não colidir com um
// convite pendente para o mesmo e-mail.
import { randomBytes } from 'node:crypto';

import { and, eq, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { contas, sessoes, tokensVerificacao, usuarios } from '../../db/schema';
import { hashSenha } from './definir-senha';

const PROVEDOR_CREDENCIAL = 'credencial';
const PREFIXO_IDENTIFICADOR_RESET = 'reset';

// Prazo do token de reset — número exato depende de Q-006 (spec, em aberto);
// 1h é o default razoável até a resposta, documentado aqui.
export const TTL_RESET_MS = 60 * 60 * 1000;

/** Convenção do `identificador` em `tokens_verificacao` para tokens de reset. */
export function identificadorReset(email: string): string {
  return `${PREFIXO_IDENTIFICADOR_RESET}:${email}`;
}

export class ErroTokenResetInvalido extends Error {
  constructor() {
    super('Token de reset de senha inválido, expirado ou já utilizado.');
    this.name = 'ErroTokenResetInvalido';
  }
}

export interface SolicitarResetSenhaOpcoes {
  agora?: () => Date;
  gerarToken?: () => string;
  ttlMs?: number;
}

export interface SolicitarResetSenhaResultado {
  solicitado: true;
}

/**
 * Solicita o reset de senha para um e-mail (US-017).
 *
 * - AC-042: a resposta é sempre `{ solicitado: true }`, exista ou não um
 *   usuário com esse e-mail — só o efeito colateral (token gerado) difere,
 *   nunca a resposta observável, para não permitir enumeração de contas.
 */
export async function solicitarResetSenha(
  db: NodePgDatabase,
  email: string,
  opcoes: SolicitarResetSenhaOpcoes = {}
): Promise<SolicitarResetSenhaResultado> {
  const agora = opcoes.agora ? opcoes.agora() : new Date();

  const usuariosEncontrados = await db
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(eq(usuarios.email, email))
    .limit(1);

  const usuario = usuariosEncontrados[0];
  if (usuario) {
    const token = opcoes.gerarToken ? opcoes.gerarToken() : randomBytes(32).toString('hex');
    const expiraEm = new Date(agora.getTime() + (opcoes.ttlMs ?? TTL_RESET_MS));

    await db.insert(tokensVerificacao).values({
      identificador: identificadorReset(email),
      valor: token,
      expiraEm,
    });
  }

  return { solicitado: true };
}

export interface ResetarSenhaOpcoes {
  agora?: () => Date;
}

export interface ResetarSenhaResultado {
  usuarioId: string;
  email: string;
  sessoesRevogadas: number;
}

/**
 * Redefine a senha de um usuário a partir do token de reset (US-017).
 *
 * - AC-041: token válido atualiza a credencial, invalida o token (uso
 *   único) e revoga todas as sessões ativas do usuário em `sessoes`.
 */
export async function resetarSenhaComToken(
  db: NodePgDatabase,
  token: string,
  novaSenha: string,
  opcoes: ResetarSenhaOpcoes = {}
): Promise<ResetarSenhaResultado> {
  const agora = opcoes.agora ? opcoes.agora() : new Date();

  return db.transaction(async (tx) => {
    const registros = await tx
      .select()
      .from(tokensVerificacao)
      .where(and(eq(tokensVerificacao.valor, token), gt(tokensVerificacao.expiraEm, agora)))
      .limit(1);

    const registro = registros[0];
    const prefixo = `${PREFIXO_IDENTIFICADOR_RESET}:`;
    if (!registro || !registro.identificador.startsWith(prefixo)) {
      throw new ErroTokenResetInvalido();
    }

    const email = registro.identificador.slice(prefixo.length);
    const usuariosEncontrados = await tx
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.email, email))
      .limit(1);

    const usuario = usuariosEncontrados[0];
    if (!usuario) {
      throw new ErroTokenResetInvalido();
    }

    // Uso único (AC-041): apaga o token antes de trocar a senha. Se uma
    // segunda chamada concorrente já apagou a linha, `returning` vem vazio e
    // a operação é recusada sem tocar na credencial nem revogar sessões.
    const apagados = await tx
      .delete(tokensVerificacao)
      .where(eq(tokensVerificacao.id, registro.id))
      .returning({ id: tokensVerificacao.id });
    if (apagados.length === 0) {
      throw new ErroTokenResetInvalido();
    }

    const novoHash = hashSenha(novaSenha);
    const atualizados = await tx
      .update(contas)
      .set({ senha: novoHash })
      .where(and(eq(contas.usuarioId, usuario.id), eq(contas.idProvedor, PROVEDOR_CREDENCIAL)))
      .returning({ id: contas.id });

    if (atualizados.length === 0) {
      await tx.insert(contas).values({
        usuarioId: usuario.id,
        idConta: email,
        idProvedor: PROVEDOR_CREDENCIAL,
        senha: novoHash,
      });
    }

    const sessoesRevogadas = await tx
      .delete(sessoes)
      .where(eq(sessoes.usuarioId, usuario.id))
      .returning({ id: sessoes.id });

    return { usuarioId: usuario.id, email, sessoesRevogadas: sessoesRevogadas.length };
  });
}
