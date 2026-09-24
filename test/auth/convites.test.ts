// Testes de T-028 (fase1-auth-rbac, US-015): convite de usuário por
// administrador da empresa, contra um Postgres 15 efêmero real (harness de
// T-020) com as migrations do schema aplicadas — os mesmos moldes de
// test/db/funcoes.test.ts e test/db/seeds.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { empresasUsuarios, tokensVerificacao, usuarios } from '../../src/db/schema';
import {
  convidarUsuario,
  identificadorConvite,
  ErroConviteEmpresaObrigatoria,
  ErroConvitePermissaoNegada,
  type AtorConvite,
} from '../../src/lib/auth/convites';

const EMPRESA_X = 'cccccccc-0000-0000-0000-000000000001';
const EMPRESA_Y = 'cccccccc-0000-0000-0000-000000000002';

const MASTER_X = 'cccccccc-0000-0000-0000-000000000011';
const GERENTE_X = 'cccccccc-0000-0000-0000-000000000012';
const ATENDENTE_X = 'cccccccc-0000-0000-0000-000000000013';
const SUPER_ADMIN = 'cccccccc-0000-0000-0000-000000000014';

function ator(overrides: Partial<AtorConvite>): AtorConvite {
  return {
    usuarioId: MASTER_X,
    empresaId: EMPRESA_X,
    papel: 'MASTER',
    isSuperAdmin: false,
    ...overrides,
  };
}

describe('T-028: convite de usuário por administrador da empresa', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_X}', 'Empresa X', 'empresa-x-convites'),
         ('${EMPRESA_Y}', 'Empresa Y', 'empresa-y-convites');
       INSERT INTO "usuarios" ("id", "email", "nome", "is_super_admin") VALUES
         ('${MASTER_X}', 'master.x@teste.com', 'Master X', false),
         ('${GERENTE_X}', 'gerente.x@teste.com', 'Gerente X', false),
         ('${ATENDENTE_X}', 'atendente.x@teste.com', 'Atendente X', false),
         ('${SUPER_ADMIN}', 'super@teste.com', 'Super Admin', true);
       INSERT INTO "empresas_usuarios" ("empresa_id", "usuario_id", "papel") VALUES
         ('${EMPRESA_X}', '${MASTER_X}', 'MASTER'),
         ('${EMPRESA_X}', '${GERENTE_X}', 'GERENTE'),
         ('${EMPRESA_X}', '${ATENDENTE_X}', 'ATENDENTE');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de convites: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  describe('AC-036: convite válido cria vínculo pendente e token de uso único', () => {
    test('MASTER convida um e-mail novo: vínculo em empresas_usuarios e token de uso único em tokens_verificacao @spec:AC-036', async () => {
      const email = 'novo.atendente@teste.com';
      const resultado = await convidarUsuario(
        db,
        ator({ usuarioId: MASTER_X, empresaId: EMPRESA_X, papel: 'MASTER' }),
        { email, papel: 'ATENDENTE' }
      );

      expect(resultado.empresaId).toBe(EMPRESA_X);
      expect(resultado.papel).toBe('ATENDENTE');
      expect(resultado.token).toBeTruthy();

      const vinculo = await db
        .select()
        .from(empresasUsuarios)
        .where(eq(empresasUsuarios.usuarioId, resultado.usuarioId));
      expect(vinculo).toHaveLength(1);
      expect(vinculo[0].empresaId).toBe(EMPRESA_X);
      expect(vinculo[0].papel).toBe('ATENDENTE');

      const usuarioCriado = await db.select().from(usuarios).where(eq(usuarios.email, email));
      expect(usuarioCriado).toHaveLength(1);
      expect(usuarioCriado[0].id).toBe(resultado.usuarioId);

      const tokens = await db
        .select()
        .from(tokensVerificacao)
        .where(eq(tokensVerificacao.identificador, identificadorConvite(email)));
      expect(tokens).toHaveLength(1);
      expect(tokens[0].valor).toBe(resultado.token);
      expect(tokens[0].expiraEm.getTime()).toBeGreaterThan(Date.now());
    });

    test('token de convite tem prazo curto (expira no futuro, não indefinido) @spec:AC-036', async () => {
      const email = 'prazo.curto@teste.com';
      const agora = new Date('2026-01-01T00:00:00Z');
      const resultado = await convidarUsuario(
        db,
        ator({ usuarioId: MASTER_X, empresaId: EMPRESA_X, papel: 'MASTER' }),
        { email, papel: 'ATENDENTE' },
        { agora: () => agora }
      );

      const diffMs = resultado.expiraEm.getTime() - agora.getTime();
      expect(diffMs).toBeGreaterThan(0);
      // "prazo curto": bem menor que um ano — só descarta um valor absurdo
      // (ex.: token sem expiração de fato), sem fixar o número exato de
      // Q-006 (ainda em aberto na spec).
      expect(diffMs).toBeLessThan(365 * 24 * 60 * 60 * 1000);
    });

    test('cada convite gera um token diferente (uso único não reaproveita valor) @spec:AC-036', async () => {
      const emailA = 'unico.a@teste.com';
      const emailB = 'unico.b@teste.com';
      const resultadoA = await convidarUsuario(
        db,
        ator({ usuarioId: MASTER_X, empresaId: EMPRESA_X, papel: 'MASTER' }),
        { email: emailA, papel: 'ATENDENTE' }
      );
      const resultadoB = await convidarUsuario(
        db,
        ator({ usuarioId: MASTER_X, empresaId: EMPRESA_X, papel: 'MASTER' }),
        { email: emailB, papel: 'ATENDENTE' }
      );

      expect(resultadoA.token).not.toBe(resultadoB.token);
    });
  });

  describe('AC-037: papel sem permissão de convidar é recusado', () => {
    test('ATENDENTE tenta convidar: recusado e nenhum convite criado @spec:AC-037', async () => {
      const email = 'recusado.atendente@teste.com';

      await expect(
        convidarUsuario(
          db,
          ator({ usuarioId: ATENDENTE_X, empresaId: EMPRESA_X, papel: 'ATENDENTE' }),
          { email, papel: 'ATENDENTE' }
        )
      ).rejects.toThrow(ErroConvitePermissaoNegada);

      const usuarioCriado = await db.select().from(usuarios).where(eq(usuarios.email, email));
      expect(usuarioCriado).toHaveLength(0);

      const tokens = await db
        .select()
        .from(tokensVerificacao)
        .where(eq(tokensVerificacao.identificador, identificadorConvite(email)));
      expect(tokens).toHaveLength(0);
    });

    test('GERENTE tenta convidar para MASTER: recusado (ASM-012, só pode convidar ATENDENTE) @spec:AC-037', async () => {
      const email = 'recusado.gerente@teste.com';

      await expect(
        convidarUsuario(
          db,
          ator({ usuarioId: GERENTE_X, empresaId: EMPRESA_X, papel: 'GERENTE' }),
          { email, papel: 'MASTER' }
        )
      ).rejects.toThrow(ErroConvitePermissaoNegada);

      const usuarioCriado = await db.select().from(usuarios).where(eq(usuarios.email, email));
      expect(usuarioCriado).toHaveLength(0);
    });

    test('GERENTE convida para ATENDENTE: permitido', async () => {
      const email = 'gerente.pode.atendente@teste.com';
      const resultado = await convidarUsuario(
        db,
        ator({ usuarioId: GERENTE_X, empresaId: EMPRESA_X, papel: 'GERENTE' }),
        { email, papel: 'ATENDENTE' }
      );
      expect(resultado.papel).toBe('ATENDENTE');
    });
  });

  describe('AC-038: super admin convida explicitamente para qualquer empresa', () => {
    test('super admin informa a empresa de destino: convite criado lá, com evento de auditoria @spec:AC-038', async () => {
      const email = 'convite.super@teste.com';
      const eventos: unknown[] = [];

      const resultado = await convidarUsuario(
        db,
        ator({ usuarioId: SUPER_ADMIN, empresaId: EMPRESA_X, papel: 'MASTER', isSuperAdmin: true }),
        { email, papel: 'GERENTE', empresaId: EMPRESA_Y },
        { registrarAuditoria: (evento) => void eventos.push(evento) }
      );

      expect(resultado.empresaId).toBe(EMPRESA_Y);

      const vinculo = await db
        .select()
        .from(empresasUsuarios)
        .where(eq(empresasUsuarios.usuarioId, resultado.usuarioId));
      expect(vinculo).toHaveLength(1);
      expect(vinculo[0].empresaId).toBe(EMPRESA_Y);
      expect(vinculo[0].papel).toBe('GERENTE');

      expect(eventos).toEqual([
        {
          tipo: 'convite_super_admin',
          atorId: SUPER_ADMIN,
          empresaId: EMPRESA_Y,
          papelConvidado: 'GERENTE',
          emailConvidado: email,
          criadoEm: expect.any(Date),
        },
      ]);
    });

    test('super admin sem informar a empresa de destino é recusado @spec:AC-038', async () => {
      const email = 'super.sem.empresa@teste.com';

      await expect(
        convidarUsuario(
          db,
          ator({ usuarioId: SUPER_ADMIN, empresaId: EMPRESA_X, papel: 'MASTER', isSuperAdmin: true }),
          { email, papel: 'GERENTE' }
        )
      ).rejects.toThrow(ErroConviteEmpresaObrigatoria);

      const usuarioCriado = await db.select().from(usuarios).where(eq(usuarios.email, email));
      expect(usuarioCriado).toHaveLength(0);
    });
  });
});
