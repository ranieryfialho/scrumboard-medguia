// T-209/T-210 (fase4-admin, US-137/US-138): a equipe da empresa — listar, convidar, trocar
// papel, desativar e reenviar convite. Sempre pela empresa do `contexto` (nunca de entrada).
// `empresas_usuarios` e `usuarios` não têm RLS por empresa, então todo filtro de empresa é
// explícito aqui. Regras: ASM-200 (situação), ASM-202 (quem pode o quê), ASM-203 (ninguém
// mexe em si e sempre sobra um MASTER), ASM-204 (último acesso = última sessão).
import { ErroSemAssentos, garantirAssento } from '../lib/empresa/assentos';
import { randomBytes } from 'node:crypto';

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { contas, empresasUsuarios, sessoes, tokensVerificacao, usuarios, empresas } from '../db/schema';
import { TTL_CONVITE_MS, convidarUsuario, identificadorConvite, type PapelUsuario } from '../lib/auth/convites';
import type { ContextoTenant } from '../lib/auth/tenant';

export const PAPEIS: readonly PapelUsuario[] = ['ATENDENTE', 'GERENTE', 'MASTER'];
export type SituacaoDoColaborador = 'ativo' | 'pendente' | 'inativo';

export interface Colaborador {
  usuarioId: string;
  nome: string;
  email: string;
  papel: PapelUsuario;
  status: SituacaoDoColaborador;
  ultimoAcesso: string | null;
}

export interface ListaDaEquipe {
  colaboradores: Colaborador[];
  total: number;
  resumo: { total: number; ativos: number; pendentes: number; inativos: number };
  /** fase5-empresa-dados (AC-659): vínculos ativos e o limite da empresa (`null` = sem limite). */
  assentos: { emUso: number; limite: number | null };
}

export async function todosOsColaboradores(db: NodePgDatabase, empresaId: string): Promise<Colaborador[]> {
  const linhas = await db
    .select({
      usuarioId: usuarios.id,
      nome: usuarios.nome,
      email: usuarios.email,
      papel: empresasUsuarios.papel,
      vinculoAtivo: empresasUsuarios.ativo,
      usuarioAtivo: usuarios.ativo,
    })
    .from(empresasUsuarios)
    .innerJoin(usuarios, eq(usuarios.id, empresasUsuarios.usuarioId))
    .where(eq(empresasUsuarios.empresaId, empresaId));

  const ids = linhas.map((l) => l.usuarioId);
  if (ids.length === 0) return [];

  const comSenha = new Set(
    (await db.select({ id: contas.usuarioId }).from(contas).where(and(inArray(contas.usuarioId, ids), isNotNull(contas.senha)))).map((c) => c.id)
  );
  const ultimos = new Map(
    (
      await db
        .select({ id: sessoes.usuarioId, ultimo: sql<Date>`max(${sessoes.criadoEm})` })
        .from(sessoes)
        .where(inArray(sessoes.usuarioId, ids))
        .groupBy(sessoes.usuarioId)
    ).map((s) => [s.id, s.ultimo])
  );

  return linhas
    .map((l) => ({
      usuarioId: l.usuarioId,
      nome: l.nome,
      email: l.email,
      papel: l.papel,
      status: (!l.vinculoAtivo || !l.usuarioAtivo ? 'inativo' : !comSenha.has(l.usuarioId) ? 'pendente' : 'ativo') as SituacaoDoColaborador,
      ultimoAcesso: ultimos.get(l.usuarioId) ? new Date(ultimos.get(l.usuarioId) as Date).toISOString() : null,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** AC-578/AC-579: a equipe da empresa da sessão, com filtro, busca e paginação opcionais. */
export async function listarEquipe(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: { papel?: PapelUsuario; status?: SituacaoDoColaborador; busca?: string; pagina?: number; porPagina?: number }
): Promise<ListaDaEquipe> {
  const todos = await todosOsColaboradores(db, contexto.empresaId);
  const resumo = {
    total: todos.length,
    ativos: todos.filter((c) => c.status === 'ativo').length,
    pendentes: todos.filter((c) => c.status === 'pendente').length,
    inativos: todos.filter((c) => c.status === 'inativo').length,
  };
  const termo = filtro.busca?.trim().toLowerCase();
  let filtrados = todos.filter(
    (c) =>
      (!filtro.papel || c.papel === filtro.papel) &&
      (!filtro.status || c.status === filtro.status) &&
      (!termo || c.nome.toLowerCase().includes(termo) || c.email.toLowerCase().includes(termo))
  );
  const total = filtrados.length;
  if (filtro.pagina && filtro.porPagina) filtrados = filtrados.slice((filtro.pagina - 1) * filtro.porPagina, filtro.pagina * filtro.porPagina);
  const [empresa] = await db.select({ assentos: empresas.assentos }).from(empresas).where(eq(empresas.id, contexto.empresaId)).limit(1);
  const assentos = { emUso: todos.filter((c) => c.status !== 'inativo').length, limite: empresa?.assentos ?? null };
  return { colaboradores: filtrados, total, resumo, assentos };
}

export type ResultadoAlteracao = { ok: true; colaborador: Colaborador } | { ok: false; codigo: 'COLABORADOR_NAO_ENCONTRADO' | 'NAO_PODE_ALTERAR_A_SI' | 'ULTIMO_MASTER' | 'SEM_ASSENTOS' };

/** AC-582/AC-583: troca o papel e/ou ativa e desativa o vínculo da pessoa nesta empresa. */
export async function alterarColaborador(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  usuarioId: string,
  alteracao: { papel?: PapelUsuario; ativo?: boolean }
): Promise<ResultadoAlteracao> {
  const todos = await todosOsColaboradores(db, contexto.empresaId);
  const alvo = todos.find((c) => c.usuarioId === usuarioId);
  if (!alvo) return { ok: false, codigo: 'COLABORADOR_NAO_ENCONTRADO' };
  if (alvo.usuarioId === contexto.usuarioId) return { ok: false, codigo: 'NAO_PODE_ALTERAR_A_SI' };

  const novoPapel = alteracao.papel ?? alvo.papel;
  const ficaAtivo = alteracao.ativo ?? alvo.status !== 'inativo';
  const eraMasterAtivo = alvo.papel === 'MASTER' && alvo.status !== 'inativo';
  if (eraMasterAtivo && (novoPapel !== 'MASTER' || !ficaAtivo)) {
    const outros = todos.filter((c) => c.papel === 'MASTER' && c.status !== 'inativo' && c.usuarioId !== usuarioId);
    if (outros.length === 0) return { ok: false, codigo: 'ULTIMO_MASTER' };
  }

  const reativando = alvo.status === 'inativo' && ficaAtivo;
  try {
    await db.transaction(async (tx) => {
      if (reativando) await garantirAssento(tx, contexto.empresaId); // AC-656
      await tx
        .update(empresasUsuarios)
        .set({ papel: novoPapel, ativo: ficaAtivo })
        .where(and(eq(empresasUsuarios.empresaId, contexto.empresaId), eq(empresasUsuarios.usuarioId, usuarioId)));
    });
  } catch (erro) {
    if (erro instanceof ErroSemAssentos) return { ok: false, codigo: 'SEM_ASSENTOS' };
    throw erro;
  }

  const [atualizado] = (await todosOsColaboradores(db, contexto.empresaId)).filter((c) => c.usuarioId === usuarioId);
  return { ok: true, colaborador: atualizado };
}

async function emitirToken(db: NodePgDatabase, email: string): Promise<{ token: string; expiraEm: Date }> {
  const token = randomBytes(32).toString('hex');
  const expiraEm = new Date(Date.now() + TTL_CONVITE_MS);
  // O token antigo deixa de valer: um convite por e-mail de cada vez (AC-584).
  await db.delete(tokensVerificacao).where(eq(tokensVerificacao.identificador, identificadorConvite(email)));
  await db.insert(tokensVerificacao).values({ identificador: identificadorConvite(email), valor: token, expiraEm });
  return { token, expiraEm };
}

export type ResultadoReenvio =
  | { ok: true; email: string; token: string; expiraEm: Date }
  | { ok: false; codigo: 'COLABORADOR_NAO_ENCONTRADO' | 'CONVITE_NAO_PENDENTE' | 'SEM_PERMISSAO' };

/** AC-584: novo token para quem ainda não definiu a senha; GERENTE só para ATENDENTE (ASM-202). */
export async function reenviarConvite(db: NodePgDatabase, contexto: ContextoTenant, usuarioId: string): Promise<ResultadoReenvio> {
  const alvo = (await todosOsColaboradores(db, contexto.empresaId)).find((c) => c.usuarioId === usuarioId);
  if (!alvo) return { ok: false, codigo: 'COLABORADOR_NAO_ENCONTRADO' };
  if (!contexto.isSuperAdmin && contexto.papel === 'GERENTE' && alvo.papel !== 'ATENDENTE') return { ok: false, codigo: 'SEM_PERMISSAO' };
  if (alvo.status !== 'pendente') return { ok: false, codigo: 'CONVITE_NAO_PENDENTE' };
  const { token, expiraEm } = await emitirToken(db, alvo.email);
  return { ok: true, email: alvo.email, token, expiraEm };
}

export type ResultadoConvite =
  | { ok: true; usuarioId: string; papel: PapelUsuario; token: string | null; expiraEm: Date | null; reativado: boolean; email: string }
  | { ok: false; codigo: 'JA_E_COLABORADOR' | 'SEM_PERMISSAO' | 'SEM_ASSENTOS' };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailValido(email: string): boolean {
  return EMAIL.test(email.trim());
}

/** AC-587/AC-588: convida (ou reativa) uma pessoa na empresa da sessão. A validação de formato é da rota. */
export async function convidarParaEquipe(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  entrada: { email: string; nome: string; papel: PapelUsuario }
): Promise<ResultadoConvite> {
  const email = entrada.email.trim().toLowerCase();
  const ehGerente = !contexto.isSuperAdmin && contexto.papel === 'GERENTE';
  if (ehGerente && entrada.papel !== 'ATENDENTE') return { ok: false, codigo: 'SEM_PERMISSAO' };

  const existente = (await todosOsColaboradores(db, contexto.empresaId)).find((c) => c.email.toLowerCase() === email);
  if (existente && existente.status !== 'inativo') return { ok: false, codigo: 'JA_E_COLABORADOR' };

  if (existente) {
    // Desativado: reativa o vínculo; só reenvia o convite se ainda não tinha definido a senha.
    const [comConta] = await db
      .select({ id: contas.usuarioId })
      .from(contas)
      .where(and(eq(contas.usuarioId, existente.usuarioId), isNotNull(contas.senha)))
      .limit(1);
    try {
      await db.transaction(async (tx) => {
        await garantirAssento(tx, contexto.empresaId); // AC-656
        await tx
          .update(empresasUsuarios)
          .set({ papel: entrada.papel, ativo: true })
          .where(and(eq(empresasUsuarios.empresaId, contexto.empresaId), eq(empresasUsuarios.usuarioId, existente.usuarioId)));
        await tx.update(usuarios).set({ ativo: true }).where(eq(usuarios.id, existente.usuarioId));
      });
    } catch (erro) {
      if (erro instanceof ErroSemAssentos) return { ok: false, codigo: 'SEM_ASSENTOS' };
      throw erro;
    }
    if (comConta) return { ok: true, usuarioId: existente.usuarioId, papel: entrada.papel, token: null, expiraEm: null, reativado: true, email };
    const { token, expiraEm } = await emitirToken(db, email);
    return { ok: true, usuarioId: existente.usuarioId, papel: entrada.papel, token, expiraEm, reativado: true, email };
  }

  let resultado;
  try {
    resultado = await convidarUsuario(
      db,
      { usuarioId: contexto.usuarioId, empresaId: contexto.empresaId, papel: contexto.papel, isSuperAdmin: contexto.isSuperAdmin },
      { email, nome: entrada.nome, papel: entrada.papel, empresaId: contexto.empresaId }
    );
  } catch (erro) {
    if (erro instanceof ErroSemAssentos) return { ok: false, codigo: 'SEM_ASSENTOS' };
    throw erro;
  }
  return { ok: true, usuarioId: resultado.usuarioId, papel: resultado.papel, token: resultado.token, expiraEm: resultado.expiraEm, reativado: false, email };
}

