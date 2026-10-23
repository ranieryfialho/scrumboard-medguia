// T-029 (fase1-auth-rbac, US-016): definição de senha a partir do token de
// convite de uso único gerado por T-028 (`convidarUsuario`, T-029). Cria a
// credencial em `contas`, invalida o token e deixa o usuário apto a logar —
// `hashSenha`/`verificarSenha` ficam aqui para T-027/reset (T-030)
// reaproveitarem o mesmo formato de hash.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { and, eq, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { contas, tokensVerificacao, usuarios } from '../../db/schema';
import { identificadorConvite } from './convites';

// Literal exigido pelas rotas internas do Better Auth (T-026/T-027) — nunca traduzir.
const PROVEDOR_CREDENCIAL = 'credential';
const SCRYPT_KEYLEN = 64;

// Único prefixo de identificador usado por convites (T-028) — derivado da
// mesma função para não duplicar a convenção `convite:<email>`.
const PREFIXO_IDENTIFICADOR_CONVITE = identificadorConvite('');

export class ErroTokenConviteInvalido extends Error {
  constructor() {
    super('Token de convite inválido, expirado ou já utilizado.');
    this.name = 'ErroTokenConviteInvalido';
  }
}

export function hashSenha(senha: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(senha, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

export function verificarSenha(senha: string, hashArmazenado: string): boolean {
  const [salt, hash] = hashArmazenado.split(':');
  if (!salt || !hash) return false;

  const hashCalculado = scryptSync(senha, salt, SCRYPT_KEYLEN);
  const hashEsperado = Buffer.from(hash, 'hex');
  if (hashCalculado.length !== hashEsperado.length) return false;

  return timingSafeEqual(hashCalculado, hashEsperado);
}

export interface DefinirSenhaOpcoes {
  agora?: () => Date;
  /**
   * Nome informado na ativação do convite (ASM-127, T-141/T-151) — grava em
   * `usuarios.nome`, substituindo o placeholder (e-mail) deixado por
   * `convidarUsuario`. Omitido quando quem chama não coletou nome (ex.: uso
   * interno/testes).
   */
  nome?: string;
}

export interface DefinirSenhaResultado {
  usuarioId: string;
  email: string;
}

/**
 * Define a senha de um usuário convidado a partir do token de uso único
 * gerado por `convidarUsuario` (US-016).
 *
 * - AC-039: token válido e não expirado cria a credencial em `contas` e
 *   invalida o token (apagando-o), habilitando o login.
 * - AC-040: token inexistente, expirado ou já utilizado (já apagado) é
 *   recusado sem criar ou alterar nenhuma credencial.
 */
export async function definirSenhaComToken(
  db: NodePgDatabase,
  token: string,
  novaSenha: string,
  opcoes: DefinirSenhaOpcoes = {}
): Promise<DefinirSenhaResultado> {
  const agora = opcoes.agora ? opcoes.agora() : new Date();

  return db.transaction(async (tx) => {
    const registros = await tx
      .select()
      .from(tokensVerificacao)
      .where(and(eq(tokensVerificacao.valor, token), gt(tokensVerificacao.expiraEm, agora)))
      .limit(1);

    const registro = registros[0];
    if (!registro || !registro.identificador.startsWith(PREFIXO_IDENTIFICADOR_CONVITE)) {
      throw new ErroTokenConviteInvalido();
    }

    const email = registro.identificador.slice(PREFIXO_IDENTIFICADOR_CONVITE.length);
    const usuariosEncontrados = await tx
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.email, email))
      .limit(1);

    const usuario = usuariosEncontrados[0];
    if (!usuario) {
      throw new ErroTokenConviteInvalido();
    }

    // Uso único (AC-039): apaga o token antes de criar a credencial. Se uma
    // segunda chamada concorrente já apagou a linha, `returning` vem vazio e
    // a operação é recusada (AC-040) sem criar credencial duplicada.
    const apagados = await tx
      .delete(tokensVerificacao)
      .where(eq(tokensVerificacao.id, registro.id))
      .returning({ id: tokensVerificacao.id });
    if (apagados.length === 0) {
      throw new ErroTokenConviteInvalido();
    }

    await tx.insert(contas).values({
      usuarioId: usuario.id,
      // `idConta` precisa ser o id do usuário (não o e-mail) — é o que as
      // rotas internas do Better Auth (T-026) buscam ao autenticar.
      idConta: usuario.id,
      idProvedor: PROVEDOR_CREDENCIAL,
      senha: hashSenha(novaSenha),
    });

    if (opcoes.nome) {
      await tx.update(usuarios).set({ nome: opcoes.nome }).where(eq(usuarios.id, usuario.id));
    }

    return { usuarioId: usuario.id, email };
  });
}
