// T-027 (fase1-auth-rbac, US-014): login com e-mail e senha, via
// `auth.api.signInEmail` do Better Auth configurado em `server.ts` (T-026).
// A sessão criada por essa chamada já cai em `sessoes`, no formato que
// `resolverContextoTenant` (T-031) lê.
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sessoes, usuarios } from '../../db/schema';
import type { Auth } from './server';

export class ErroLoginInvalido extends Error {
  constructor() {
    super('E-mail ou senha inválidos.');
    this.name = 'ErroLoginInvalido';
  }
}

export interface LoginResultado {
  usuarioId: string;
  token: string;
  expiraEm: Date;
}

/**
 * Autentica por e-mail e senha (US-014).
 *
 * - AC-033: credenciais corretas criam uma sessão em `sessoes` (via Better
 *   Auth) com token, expiração e cookie `httpOnly`/`Secure`/`SameSite=Lax`
 *   (configurado em `server.ts`, `advanced.defaultCookieAttributes`).
 * - AC-034: credenciais incorretas são recusadas sem criar sessão.
 * - AC-035: usuário com `ativo = false` é recusado mesmo com a senha
 *   correta — checado antes de chamar o Better Auth, que não conhece esse
 *   campo (é específico do domínio desta aplicação, não da lib).
 */
export async function login(
  auth: Auth,
  db: NodePgDatabase,
  email: string,
  senha: string
): Promise<LoginResultado> {
  const usuariosEncontrados = await db
    .select({ id: usuarios.id, ativo: usuarios.ativo })
    .from(usuarios)
    .where(eq(usuarios.email, email))
    .limit(1);

  const usuario = usuariosEncontrados[0];
  if (usuario && !usuario.ativo) {
    throw new ErroLoginInvalido();
  }

  let resultado;
  try {
    resultado = await auth.api.signInEmail({
      body: { email, password: senha },
      asResponse: false,
    });
  } catch {
    throw new ErroLoginInvalido();
  }

  if (!resultado?.token) {
    throw new ErroLoginInvalido();
  }

  // `signInEmail` não devolve `expiresAt` no corpo — a sessão que ele acabou
  // de criar em `sessoes` é a fonte da verdade.
  const [sessao] = await db
    .select({ expiraEm: sessoes.expiraEm })
    .from(sessoes)
    .where(eq(sessoes.token, resultado.token))
    .limit(1);

  return {
    usuarioId: resultado.user.id,
    token: resultado.token,
    expiraEm: sessao.expiraEm,
  };
}
