// T-212 (fase4-admin, US-140 a US-142): a rede de empresas para o super admin — listar,
// criar (já convidando o master), ver o detalhe e editar nome e situação. `empresas` e
// `empresas_usuarios` não têm RLS por empresa; quem decide o acesso é a rota (só super admin).
import { randomUUID } from 'node:crypto';

import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresas, empresasUsuarios } from '../db/schema';
import { convidarUsuario } from '../lib/auth/convites';
import type { ContextoTenant } from '../lib/auth/tenant';
import type { DadosDaEmpresa } from '../lib/empresa/validacao';
import { todosOsColaboradores, type Colaborador } from './equipe';

/** ASM-208: de 3 a 40 letras minúsculas, números e hífens, sem hífen no começo ou no fim. */
export const SLUG_VALIDO = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

export interface EmpresaDaLista {
  id: string;
  nome: string;
  slug: string;
  ativo: boolean;
  criadoEm: string;
  usuariosAtivos: number;
  usuariosTotal: number;
  /** fase5-empresa-dados (AC-654). */
  plano: string | null;
  assentos: number | null;
}

export interface ListaDeEmpresas {
  empresas: EmpresaDaLista[];
  resumo: { total: number; ativas: number; inativas: number; usuariosAtivos: number };
}

export async function listarEmpresas(db: NodePgDatabase, filtro: { status?: 'ativa' | 'inativa'; busca?: string }): Promise<ListaDeEmpresas> {
  const linhas = await db
    .select({
      id: empresas.id,
      nome: empresas.nome,
      slug: empresas.slug,
      ativo: empresas.ativo,
      criadoEm: empresas.criadoEm,
      plano: empresas.plano,
      assentos: empresas.assentos,
      usuariosAtivos: sql<number>`count(${empresasUsuarios.usuarioId}) filter (where ${empresasUsuarios.ativo})::int`,
      usuariosTotal: sql<number>`count(${empresasUsuarios.usuarioId})::int`,
    })
    .from(empresas)
    .leftJoin(empresasUsuarios, eq(empresasUsuarios.empresaId, empresas.id))
    .groupBy(empresas.id)
    .orderBy(desc(empresas.criadoEm), desc(empresas.id));

  const todas: EmpresaDaLista[] = linhas.map((l) => ({ ...l, criadoEm: l.criadoEm.toISOString() }));
  const termo = filtro.busca?.trim().toLowerCase();
  return {
    empresas: todas.filter(
      (e) =>
        (!filtro.status || (filtro.status === 'ativa') === e.ativo) &&
        (!termo || e.nome.toLowerCase().includes(termo) || e.slug.toLowerCase().includes(termo))
    ),
    resumo: {
      total: todas.length,
      ativas: todas.filter((e) => e.ativo).length,
      inativas: todas.filter((e) => !e.ativo).length,
      usuariosAtivos: todas.reduce((s, e) => s + e.usuariosAtivos, 0),
    },
  };
}

export type ResultadoCriacao =
  | { ok: true; id: string; slug: string; masterUsuarioId: string; token: string; masterEmail: string }
  | { ok: false; codigo: 'SLUG_EM_USO' | 'CNPJ_EM_USO' };

/** AC-604: cria a empresa e convida o master; se o convite falhar a empresa não fica criada. */
export async function criarEmpresa(
  db: NodePgDatabase,
  ator: ContextoTenant,
  entrada: { nome: string; slug: string; masterNome: string; masterEmail: string; dados?: Partial<DadosDaEmpresa> }
): Promise<ResultadoCriacao> {
  const [existente] = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.slug, entrada.slug)).limit(1);
  if (existente) return { ok: false, codigo: 'SLUG_EM_USO' };

  if (entrada.dados?.cnpj) {
    const [cnpjUsado] = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.cnpj, entrada.dados.cnpj)).limit(1);
    if (cnpjUsado) return { ok: false, codigo: 'CNPJ_EM_USO' };
  }

  const id = randomUUID();
  try {
    await db.insert(empresas).values({ id, nome: entrada.nome, slug: entrada.slug, ativo: true, ...entrada.dados });
  } catch {
    return { ok: false, codigo: 'SLUG_EM_USO' }; // corrida: outro super admin criou o mesmo identificador (ou CNPJ)
  }

  const email = entrada.masterEmail.trim().toLowerCase();
  try {
    const convite = await convidarUsuario(
      db,
      { usuarioId: ator.usuarioId, empresaId: ator.empresaId, papel: ator.papel, isSuperAdmin: true },
      { email, nome: entrada.masterNome, papel: 'MASTER', empresaId: id }
    );
    return { ok: true, id, slug: entrada.slug, masterUsuarioId: convite.usuarioId, token: convite.token, masterEmail: email };
  } catch (erro) {
    await db.delete(empresasUsuarios).where(eq(empresasUsuarios.empresaId, id));
    await db.delete(empresas).where(eq(empresas.id, id));
    throw erro;
  }
}

export interface DetalheDaEmpresa {
  empresa: { id: string; nome: string; slug: string; ativo: boolean; criadoEm: string } & DadosDaEmpresa;
  assentosEmUso: number;
  colaboradores: Colaborador[];
  resumo: { ativos: number; pendentes: number; inativos: number; total: number };
}

function dadosDaLinha(e: typeof empresas.$inferSelect): DadosDaEmpresa {
  return {
    razaoSocial: e.razaoSocial,
    cnpj: e.cnpj,
    cep: e.cep,
    logradouro: e.logradouro,
    numero: e.numero,
    complemento: e.complemento,
    bairro: e.bairro,
    cidade: e.cidade,
    uf: e.uf,
    plano: e.plano as DadosDaEmpresa['plano'],
    assentos: e.assentos,
  };
}

export async function detalharEmpresa(db: NodePgDatabase, id: string): Promise<DetalheDaEmpresa | null> {
  const [e] = await db.select().from(empresas).where(eq(empresas.id, id)).limit(1);
  if (!e) return null;
  const colaboradores = await todosOsColaboradores(db, id);
  return {
    empresa: { id: e.id, nome: e.nome, slug: e.slug, ativo: e.ativo, criadoEm: e.criadoEm.toISOString(), ...dadosDaLinha(e) },
    assentosEmUso: colaboradores.filter((c) => c.status !== 'inativo').length,
    colaboradores,
    resumo: {
      total: colaboradores.length,
      ativos: colaboradores.filter((c) => c.status === 'ativo').length,
      pendentes: colaboradores.filter((c) => c.status === 'pendente').length,
      inativos: colaboradores.filter((c) => c.status === 'inativo').length,
    },
  };
}

export type ResultadoEdicao =
  | { ok: true; empresa: DetalheDaEmpresa['empresa'] }
  | { ok: false; codigo: 'EMPRESA_NAO_ENCONTRADA' | 'EMPRESA_ATUAL' | 'CNPJ_EM_USO' | 'ASSENTOS_ABAIXO_DO_EM_USO' };

/**
 * AC-609/AC-653: muda nome, situação e os dados cadastrais; o identificador nunca muda, a empresa em
 * que o próprio super admin está não é suspensa, o CNPJ é único e os assentos não ficam abaixo do uso.
 */
export async function editarEmpresa(
  db: NodePgDatabase,
  ator: ContextoTenant,
  id: string,
  alteracao: { nome?: string; ativo?: boolean; dados?: Partial<DadosDaEmpresa> }
): Promise<ResultadoEdicao> {
  const [atual] = await db.select().from(empresas).where(eq(empresas.id, id)).limit(1);
  if (!atual) return { ok: false, codigo: 'EMPRESA_NAO_ENCONTRADA' };
  if (alteracao.ativo === false && id === ator.empresaId) return { ok: false, codigo: 'EMPRESA_ATUAL' };

  const dados = alteracao.dados ?? {};
  if (dados.cnpj) {
    const [outra] = await db.select({ id: empresas.id }).from(empresas).where(and(eq(empresas.cnpj, dados.cnpj), ne(empresas.id, id))).limit(1);
    if (outra) return { ok: false, codigo: 'CNPJ_EM_USO' };
  }
  if (typeof dados.assentos === 'number') {
    const [uso] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(empresasUsuarios)
      .where(and(eq(empresasUsuarios.empresaId, id), eq(empresasUsuarios.ativo, true)));
    if (dados.assentos < uso.total) return { ok: false, codigo: 'ASSENTOS_ABAIXO_DO_EM_USO' };
  }

  const [novo] = await db
    .update(empresas)
    .set({ ...dados, nome: alteracao.nome ?? atual.nome, ativo: alteracao.ativo ?? atual.ativo, atualizadoEm: new Date() })
    .where(and(eq(empresas.id, id)))
    .returning();
  return { ok: true, empresa: { id: novo.id, nome: novo.nome, slug: novo.slug, ativo: novo.ativo, criadoEm: novo.criadoEm.toISOString(), ...dadosDaLinha(novo) } };
}
