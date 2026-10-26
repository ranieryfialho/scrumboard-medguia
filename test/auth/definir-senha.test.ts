// Testes de T-029 (fase1-auth-rbac, US-016): definição de senha a partir do
// token de convite (gerado por `convidarUsuario`, T-028), contra um
// Postgres 15 efêmero real (harness de T-020) — os mesmos moldes de
// test/auth/convites.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { contas, tokensVerificacao, usuarios } from '../../src/db/schema';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import {
  definirSenhaComToken,
  verificarSenha,
  ErroTokenConviteInvalido,
} from '../../src/lib/auth/definir-senha';

const EMPRESA_X = 'dddddddd-0000-0000-0000-000000000001';
const MASTER_X = 'dddddddd-0000-0000-0000-000000000011';

const ATOR_MASTER: AtorConvite = {
  usuarioId: MASTER_X,
  empresaId: EMPRESA_X,
  papel: 'MASTER',
  isSuperAdmin: false,
};

describe('T-029: definição de senha a partir do convite', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_X}', 'Empresa X', 'empresa-x-definir-senha');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de definir-senha: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  describe('AC-039: token de convite válido define a senha e habilita o login', () => {
    test('define senha com token válido: credencial criada e token invalidado @spec:AC-039', async () => {
      const email = 'convidado.senha@teste.com';
      const convite = await convidarUsuario(db, ATOR_MASTER, { email, papel: 'ATENDENTE' });

      const resultado = await definirSenhaComToken(db, convite.token, 'senha-super-secreta');

      expect(resultado.usuarioId).toBe(convite.usuarioId);
      expect(resultado.email).toBe(email);

      const credenciais = await db.select().from(contas).where(eq(contas.usuarioId, convite.usuarioId));
      expect(credenciais).toHaveLength(1);
      expect(credenciais[0].senha).toBeTruthy();
      expect(verificarSenha('senha-super-secreta', credenciais[0].senha!)).toBe(true);
      expect(verificarSenha('senha-errada', credenciais[0].senha!)).toBe(false);

      const tokensRestantes = await db
        .select()
        .from(tokensVerificacao)
        .where(eq(tokensVerificacao.valor, convite.token));
      expect(tokensRestantes).toHaveLength(0);
    });

    test('nome informado na ativação do convite substitui o placeholder (ASM-127)', async () => {
      const email = 'convidado.nome@teste.com';
      const convite = await convidarUsuario(db, ATOR_MASTER, { email, papel: 'ATENDENTE' });

      const antes = await db.select().from(usuarios).where(eq(usuarios.id, convite.usuarioId));
      expect(antes[0].nome).toBe(email);

      await definirSenhaComToken(db, convite.token, 'senha-com-nome', { nome: 'Dra. Juliana Lopes' });

      const depois = await db.select().from(usuarios).where(eq(usuarios.id, convite.usuarioId));
      expect(depois[0].nome).toBe('Dra. Juliana Lopes');
    });

    test('sem nome informado, o placeholder do convite é preservado', async () => {
      const email = 'convidado.sem.nome@teste.com';
      const convite = await convidarUsuario(db, ATOR_MASTER, { email, papel: 'ATENDENTE' });

      await definirSenhaComToken(db, convite.token, 'senha-sem-nome');

      const depois = await db.select().from(usuarios).where(eq(usuarios.id, convite.usuarioId));
      expect(depois[0].nome).toBe(email);
    });
  });

  describe('AC-040: token expirado ou já usado é recusado', () => {
    test('token expirado é recusado: nenhuma credencial criada @spec:AC-040', async () => {
      const email = 'expirado.senha@teste.com';
      const convite = await convidarUsuario(
        db,
        ATOR_MASTER,
        { email, papel: 'ATENDENTE' },
        { agora: () => new Date(Date.now() - 60_000), ttlMs: 1_000 }
      );

      await expect(definirSenhaComToken(db, convite.token, 'nova-senha')).rejects.toThrow(
        ErroTokenConviteInvalido
      );

      const credenciais = await db.select().from(contas).where(eq(contas.usuarioId, convite.usuarioId));
      expect(credenciais).toHaveLength(0);

      const tokensRestantes = await db
        .select()
        .from(tokensVerificacao)
        .where(eq(tokensVerificacao.valor, convite.token));
      expect(tokensRestantes).toHaveLength(1);
    });

    test('token já utilizado é recusado na segunda tentativa: credencial original preservada @spec:AC-040', async () => {
      const email = 'reuso.senha@teste.com';
      const convite = await convidarUsuario(db, ATOR_MASTER, { email, papel: 'ATENDENTE' });

      await definirSenhaComToken(db, convite.token, 'primeira-senha');

      await expect(definirSenhaComToken(db, convite.token, 'segunda-senha')).rejects.toThrow(
        ErroTokenConviteInvalido
      );

      const credenciais = await db.select().from(contas).where(eq(contas.usuarioId, convite.usuarioId));
      expect(credenciais).toHaveLength(1);
      expect(verificarSenha('primeira-senha', credenciais[0].senha!)).toBe(true);
      expect(verificarSenha('segunda-senha', credenciais[0].senha!)).toBe(false);
    });

    test('token inexistente é recusado: nenhuma credencial criada @spec:AC-040', async () => {
      await expect(
        definirSenhaComToken(db, 'token-que-nunca-existiu', 'qualquer-senha')
      ).rejects.toThrow(ErroTokenConviteInvalido);

      const credenciais = await db.select().from(contas);
      expect(credenciais.find((c) => c.idConta === 'inexistente@teste.com')).toBeUndefined();
    });
  });
});
