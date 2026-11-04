// T-031 (fase1-auth-rbac, US-018): resolução de sessão e tenant no servidor.
// Toda rota protegida precisa saber `empresa_id` e `papel` de quem está
// chamando — esta função é o único ponto que resolve isso, sempre a partir
// da sessão em `sessoes` (nunca do corpo da requisição, AC-043). Sessão
// ausente, expirada ou revogada (linha apagada por T-030) é sempre recusada
// (AC-044).
import { and, eq, gt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresas, empresasUsuarios, sessoes, usuarios } from '../../db/schema';
import type { PapelUsuario } from './convites';

export class ErroSessaoInvalida extends Error {
  constructor() {
    super('Sessão ausente, expirada ou revogada.');
    this.name = 'ErroSessaoInvalida';
  }
}

export interface ResolverContextoTenantInput {
  /** Token da sessão (ex.: cookie) — `undefined`/`null` conta como ausente. */
  token: string | null | undefined;
  /**
   * `empresa_id` eventualmente presente no corpo da requisição. Nunca é lido
   * por esta função — existe só para deixar explícito, no chamador, que o
   * valor foi recebido e propositalmente ignorado (AC-043).
   */
  empresaIdCorpo?: string;
}

export interface ResolverContextoTenantOpcoes {
  agora?: () => Date;
}

export interface ContextoTenant {
  usuarioId: string;
  empresaId: string;
  papel: PapelUsuario;
  isSuperAdmin: boolean;
  /** T-322: módulos liberados do vínculo (`null` ou ausente = padrão do papel). */
  modulos?: string[] | null;
}

/**
 * Resolve `empresa_id` e papel do ator autenticado a partir da sessão
 * (US-018).
 *
 * - AC-043: o `empresa_id` resolvido vem exclusivamente da sessão — o campo
 *   `empresaIdCorpo` do input nunca é lido.
 * - AC-044: sem sessão válida (token ausente, sessão inexistente, expirada
 *   ou já revogada) a resolução é recusada com `ErroSessaoInvalida`.
 */
export async function resolverContextoTenant(
  db: NodePgDatabase,
  input: ResolverContextoTenantInput,
  opcoes: ResolverContextoTenantOpcoes = {}
): Promise<ContextoTenant> {
  const agora = opcoes.agora ? opcoes.agora() : new Date();

  if (!input.token) {
    throw new ErroSessaoInvalida();
  }

  const sessoesEncontradas = await db
    .select({ usuarioId: sessoes.usuarioId, empresaAtivaId: sessoes.empresaAtivaId })
    .from(sessoes)
    .where(and(eq(sessoes.token, input.token), gt(sessoes.expiraEm, agora)))
    .limit(1);

  const sessao = sessoesEncontradas[0];
  if (!sessao) {
    throw new ErroSessaoInvalida();
  }

  const usuariosEncontrados = await db
    .select({ isSuperAdmin: usuarios.isSuperAdmin, ativo: usuarios.ativo })
    .from(usuarios)
    .where(eq(usuarios.id, sessao.usuarioId))
    .limit(1);

  const usuario = usuariosEncontrados[0];
  if (!usuario || !usuario.ativo) {
    throw new ErroSessaoInvalida();
  }

  // fase4-admin (AC-610, ASM-207): o vínculo só vale se a empresa está ativa — empresa suspensa não
  // dá acesso (o super admin não é barrado: ele administra a rede inclusive as suspensas).
  // AC-728/AC-729: só o super admin atua na empresa que escolheu (gravada na sessão); para qualquer outro usuário a coluna
  // é ignorada, mesmo que alguém a preencha: o vínculo dele é o que vale.
  if (usuario.isSuperAdmin && sessao.empresaAtivaId) {
    const [escolhida] = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.id, sessao.empresaAtivaId)).limit(1);
    if (escolhida) {
      const [vinculoNaEscolhida] = await db
        .select({ papel: empresasUsuarios.papel, modulos: empresasUsuarios.modulos })
        .from(empresasUsuarios)
        .where(and(eq(empresasUsuarios.usuarioId, sessao.usuarioId), eq(empresasUsuarios.empresaId, escolhida.id), eq(empresasUsuarios.ativo, true)))
        .limit(1);
      return { usuarioId: sessao.usuarioId, empresaId: escolhida.id, papel: vinculoNaEscolhida?.papel ?? 'MASTER', isSuperAdmin: true };
    }
  }

  const empresaAtiva = usuario.isSuperAdmin ? sql`true` : eq(empresas.ativo, true);
  const vinculos = await db
    .select({ empresaId: empresasUsuarios.empresaId, papel: empresasUsuarios.papel, modulos: empresasUsuarios.modulos })
    .from(empresasUsuarios)
    .innerJoin(empresas, eq(empresas.id, empresasUsuarios.empresaId))
    .where(and(eq(empresasUsuarios.usuarioId, sessao.usuarioId), eq(empresasUsuarios.ativo, true), empresaAtiva))
    .orderBy(empresasUsuarios.criadoEm, empresasUsuarios.empresaId)
    .limit(1);

  const vinculo = vinculos[0];
  if (!vinculo) {
    throw new ErroSessaoInvalida();
  }

  return {
    usuarioId: sessao.usuarioId,
    empresaId: vinculo.empresaId,
    papel: vinculo.papel,
    isSuperAdmin: usuario.isSuperAdmin,
    ...(vinculo.modulos ? { modulos: vinculo.modulos } : {}),
  };
}
