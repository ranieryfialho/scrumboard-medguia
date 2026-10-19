// Testes de T-109 (fase3-etl-supabase, US-069): migração de empresas e
// usuários (src/etl/supabase/identidade.ts). Contra Postgres real (mesmo
// harness de T-020/T-108) porque precisamos provar que as linhas de
// `empresas`, `usuarios` e `empresas_usuarios` ficam exatamente como a
// migração deveria gravá-las — um mock não prova isso.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { executarEtl, type ContextoExecucao } from '../../src/etl/comum';
import {
  migrarEmpresas,
  migrarUsuarios,
  traduzirPapel,
  type EmpresaLegado,
  type UsuarioLegado,
} from '../../src/etl/supabase/identidade';
import { contas, empresas, empresasUsuarios, usuarios } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-109: traduzirPapel (@spec:AC-253)', () => {
  test('ADMIN vira GERENTE; COMERCIAL e MARKETING viram ATENDENTE', () => {
    expect(traduzirPapel('ADMIN')).toBe('GERENTE');
    expect(traduzirPapel('COMERCIAL')).toBe('ATENDENTE');
    expect(traduzirPapel('MARKETING')).toBe('ATENDENTE');
  });
});

describe('T-109: migração de empresas e usuários contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const contexto: ContextoExecucao = { origem: 'supabase-legado', simulacao: false };

  const empresaA: EmpresaLegado = {
    id: '10000000-0000-0000-0000-000000000001',
    nome: 'Clínica A',
    slug: 'clinica-a',
  };
  const empresaB: EmpresaLegado = {
    id: '20000000-0000-0000-0000-000000000002',
    nome: 'Clínica B',
    slug: 'clinica-b',
  };

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.migratorUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  beforeEach(async () => {
    await db.delete(empresasUsuarios);
    await db.delete(contas);
    await db.delete(usuarios);
    await db.delete(empresas);
    await db.execute('DELETE FROM migracao_registros');
  });

  test('empresas migram com o mesmo id e o mesmo slug (@spec:AC-252)', async () => {
    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      migrarEmpresas(tx, ctx, [empresaA, empresaB])
    );

    expect(resultado).toEqual({ lidas: 2, criadas: 2, ignoradas: 0 });

    const linhas = await db.select().from(empresas).orderBy(empresas.slug);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ id: empresaA.id, slug: empresaA.slug });
    expect(linhas[1]).toMatchObject({ id: empresaB.id, slug: empresaB.slug });
  });

  test('rodar de novo sobre a mesma empresa não duplica — fica ignorada', async () => {
    await executarEtl(db, contexto, (tx, ctx) => migrarEmpresas(tx, ctx, [empresaA]));
    const resultado = await executarEtl(db, contexto, (tx, ctx) => migrarEmpresas(tx, ctx, [empresaA]));

    expect(resultado).toEqual({ lidas: 1, criadas: 0, ignoradas: 1 });
    const linhas = await db.select().from(empresas);
    expect(linhas).toHaveLength(1);
  });

  test('usuário comum migra com o mesmo id, vinculado só à empresa de origem, e papel traduzido (@spec:AC-253) (@spec:AC-271)', async () => {
    await executarEtl(db, contexto, (tx, ctx) => migrarEmpresas(tx, ctx, [empresaA, empresaB]));

    const comercialA: UsuarioLegado = {
      id: '30000000-0000-0000-0000-000000000003',
      email: 'comercial@a.com',
      nome: 'Comercial A',
      perfil: 'COMERCIAL',
      ativo: true,
      empresaId: empresaA.id,
      isSuperAdmin: false,
    };
    const adminB: UsuarioLegado = {
      id: '40000000-0000-0000-0000-000000000004',
      email: 'admin@b.com',
      nome: 'Admin B',
      perfil: 'ADMIN',
      ativo: true,
      empresaId: empresaB.id,
      isSuperAdmin: false,
    };

    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      migrarUsuarios(tx, ctx, [comercialA, adminB], [empresaA.id, empresaB.id])
    );

    expect(resultado).toEqual({ lidas: 2, criadas: 2, ignoradas: 0 });

    const usuariosDestino = await db.select().from(usuarios).orderBy(usuarios.email);
    expect(usuariosDestino).toHaveLength(2);
    expect(usuariosDestino.find((u) => u.id === comercialA.id)).toMatchObject({
      id: comercialA.id,
      email: comercialA.email,
    });

    const vinculosComercialA = await db
      .select()
      .from(empresasUsuarios)
      .where(eq(empresasUsuarios.usuarioId, comercialA.id));
    expect(vinculosComercialA).toHaveLength(1);
    expect(vinculosComercialA[0]).toMatchObject({ empresaId: empresaA.id, papel: 'ATENDENTE' });

    const vinculosAdminB = await db
      .select()
      .from(empresasUsuarios)
      .where(eq(empresasUsuarios.usuarioId, adminB.id));
    expect(vinculosAdminB).toHaveLength(1);
    expect(vinculosAdminB[0]).toMatchObject({ empresaId: empresaB.id, papel: 'GERENTE' });

    // AC-271: cada vínculo pertence à mesma empresa que tinha na origem — nada da B aparece ligado ao usuário da A.
    const vinculoCruzado = await db
      .select()
      .from(empresasUsuarios)
      .where(and(eq(empresasUsuarios.usuarioId, comercialA.id), eq(empresasUsuarios.empresaId, empresaB.id)));
    expect(vinculoCruzado).toHaveLength(0);
  });

  test('super admin vira MASTER nas duas empresas (ASM-081/Q-028, @spec:AC-253)', async () => {
    await executarEtl(db, contexto, (tx, ctx) => migrarEmpresas(tx, ctx, [empresaA, empresaB]));

    const superAdmin: UsuarioLegado = {
      id: '50000000-0000-0000-0000-000000000005',
      email: 'super@legado.com',
      nome: 'Super Admin',
      perfil: 'ADMIN',
      ativo: true,
      empresaId: empresaA.id,
      isSuperAdmin: true,
    };

    await executarEtl(db, contexto, (tx, ctx) =>
      migrarUsuarios(tx, ctx, [superAdmin], [empresaA.id, empresaB.id])
    );

    const [usuarioDestino] = await db.select().from(usuarios).where(eq(usuarios.id, superAdmin.id));
    expect(usuarioDestino.isSuperAdmin).toBe(true);

    const vinculos = await db
      .select()
      .from(empresasUsuarios)
      .where(eq(empresasUsuarios.usuarioId, superAdmin.id));
    expect(vinculos).toHaveLength(2);
    expect(vinculos.every((v) => v.papel === 'MASTER')).toBe(true);
    expect(vinculos.map((v) => v.empresaId).sort()).toEqual([empresaA.id, empresaB.id].sort());
  });

  test('usuário inativo no legado migra desativado, tanto em `usuarios` quanto no vínculo (@spec:AC-254)', async () => {
    await executarEtl(db, contexto, (tx, ctx) => migrarEmpresas(tx, ctx, [empresaA]));

    const inativo: UsuarioLegado = {
      id: '60000000-0000-0000-0000-000000000006',
      email: 'inativo@a.com',
      nome: 'Usuário Inativo',
      perfil: 'COMERCIAL',
      ativo: false,
      empresaId: empresaA.id,
      isSuperAdmin: false,
    };

    await executarEtl(db, contexto, (tx, ctx) => migrarUsuarios(tx, ctx, [inativo], [empresaA.id]));

    const [usuarioDestino] = await db.select().from(usuarios).where(eq(usuarios.id, inativo.id));
    expect(usuarioDestino.ativo).toBe(false);

    const [vinculo] = await db
      .select()
      .from(empresasUsuarios)
      .where(eq(empresasUsuarios.usuarioId, inativo.id));
    expect(vinculo.ativo).toBe(false);
  });

  test('nenhum usuário migrado tem credencial de senha (@spec:AC-255)', async () => {
    await executarEtl(db, contexto, (tx, ctx) => migrarEmpresas(tx, ctx, [empresaA]));

    const usuarioComSenhaSoNoLegado: UsuarioLegado = {
      id: '70000000-0000-0000-0000-000000000007',
      email: 'comsenha@a.com',
      nome: 'Usuário Com Senha No Legado',
      perfil: 'MARKETING',
      ativo: true,
      empresaId: empresaA.id,
      isSuperAdmin: false,
    };

    await executarEtl(db, contexto, (tx, ctx) =>
      migrarUsuarios(tx, ctx, [usuarioComSenhaSoNoLegado], [empresaA.id])
    );

    // `UsuarioLegado` não tem campo de senha — não há como a migração ler ou
    // gravar uma credencial. A tabela `contas` (onde o Better Auth guarda
    // `senha`) permanece vazia para o usuário migrado.
    const credenciais = await db
      .select()
      .from(contas)
      .where(eq(contas.usuarioId, usuarioComSenhaSoNoLegado.id));
    expect(credenciais).toHaveLength(0);

    const [usuarioDestino] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, usuarioComSenhaSoNoLegado.id));
    expect(usuarioDestino).not.toHaveProperty('senha');
  });

  test('rodar de novo sobre o mesmo usuário não duplica — fica ignorado', async () => {
    await executarEtl(db, contexto, (tx, ctx) => migrarEmpresas(tx, ctx, [empresaA]));

    const usuario: UsuarioLegado = {
      id: '80000000-0000-0000-0000-000000000008',
      email: 'repetido@a.com',
      nome: 'Usuário Repetido',
      perfil: 'COMERCIAL',
      ativo: true,
      empresaId: empresaA.id,
      isSuperAdmin: false,
    };

    await executarEtl(db, contexto, (tx, ctx) => migrarUsuarios(tx, ctx, [usuario], [empresaA.id]));
    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      migrarUsuarios(tx, ctx, [usuario], [empresaA.id])
    );

    expect(resultado).toEqual({ lidas: 1, criadas: 0, ignoradas: 1 });
    const linhas = await db.select().from(usuarios).where(eq(usuarios.id, usuario.id));
    expect(linhas).toHaveLength(1);
    const vinculos = await db
      .select()
      .from(empresasUsuarios)
      .where(eq(empresasUsuarios.usuarioId, usuario.id));
    expect(vinculos).toHaveLength(1);
  });
});
