// Testes de T-030 (fase1-auth-rbac, US-017): reset de senha, contra um
// Postgres 15 efêmero real (harness de T-020) — os mesmos moldes de
// test/auth/definir-senha.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { contas, sessoes, tokensVerificacao } from '../../src/db/schema';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken, verificarSenha } from '../../src/lib/auth/definir-senha';
import {
  identificadorReset,
  resetarSenhaComToken,
  solicitarResetSenha,
  ErroTokenResetInvalido,
} from '../../src/lib/auth/reset-senha';

const EMPRESA_X = 'eeeeeeee-0000-0000-0000-000000000001';
const MASTER_X = 'eeeeeeee-0000-0000-0000-000000000011';

const ATOR_MASTER: AtorConvite = {
  usuarioId: MASTER_X,
  empresaId: EMPRESA_X,
  papel: 'MASTER',
  isSuperAdmin: false,
};

describe('T-030: reset de senha', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_X}', 'Empresa X', 'empresa-x-reset-senha');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de reset-senha: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  /** Cria um usuário com credencial já definida, via convite + definição de senha (T-028/T-029). */
  async function criarUsuarioComCredencial(email: string, senha: string) {
    const convite = await convidarUsuario(db, ATOR_MASTER, { email, papel: 'ATENDENTE' });
    await definirSenhaComToken(db, convite.token, senha);
    return convite.usuarioId;
  }

  async function criarSessaoAtiva(usuarioId: string) {
    const [linha] = await db
      .insert(sessoes)
      .values({
        usuarioId,
        token: randomBytes(32).toString('hex'),
        expiraEm: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: sessoes.id });
    return linha.id;
  }

  describe('AC-041: reset com token válido troca a senha e revoga sessões ativas', () => {
    test('token válido troca a senha e revoga todas as sessões ativas @spec:AC-041', async () => {
      const email = 'reset.valido@teste.com';
      const usuarioId = await criarUsuarioComCredencial(email, 'senha-antiga');

      await criarSessaoAtiva(usuarioId);
      await criarSessaoAtiva(usuarioId);
      const sessoesAntes = await db.select().from(sessoes).where(eq(sessoes.usuarioId, usuarioId));
      expect(sessoesAntes).toHaveLength(2);

      const token = randomBytes(32).toString('hex');
      await db.insert(tokensVerificacao).values({
        identificador: identificadorReset(email),
        valor: token,
        expiraEm: new Date(Date.now() + 60 * 60 * 1000),
      });

      const resultado = await resetarSenhaComToken(db, token, 'Senha-nova1');

      expect(resultado.usuarioId).toBe(usuarioId);
      expect(resultado.email).toBe(email);
      expect(resultado.sessoesRevogadas).toBe(2);

      const credenciais = await db.select().from(contas).where(eq(contas.usuarioId, usuarioId));
      expect(credenciais).toHaveLength(1);
      expect(verificarSenha('Senha-nova1', credenciais[0].senha!)).toBe(true);
      expect(verificarSenha('senha-antiga', credenciais[0].senha!)).toBe(false);

      const sessoesDepois = await db.select().from(sessoes).where(eq(sessoes.usuarioId, usuarioId));
      expect(sessoesDepois).toHaveLength(0);

      const tokensRestantes = await db
        .select()
        .from(tokensVerificacao)
        .where(eq(tokensVerificacao.valor, token));
      expect(tokensRestantes).toHaveLength(0);
    });

    test('token de reset expirado é recusado: senha e sessões preservadas @spec:AC-041', async () => {
      const email = 'reset.expirado@teste.com';
      const usuarioId = await criarUsuarioComCredencial(email, 'senha-antiga');
      await criarSessaoAtiva(usuarioId);

      const token = randomBytes(32).toString('hex');
      await db.insert(tokensVerificacao).values({
        identificador: identificadorReset(email),
        valor: token,
        expiraEm: new Date(Date.now() - 60_000),
      });

      await expect(resetarSenhaComToken(db, token, 'Senha-nova1')).rejects.toThrow(
        ErroTokenResetInvalido
      );

      const credenciais = await db.select().from(contas).where(eq(contas.usuarioId, usuarioId));
      expect(verificarSenha('senha-antiga', credenciais[0].senha!)).toBe(true);

      const sessoesDepois = await db.select().from(sessoes).where(eq(sessoes.usuarioId, usuarioId));
      expect(sessoesDepois).toHaveLength(1);
    });

    test('token de reset já utilizado é recusado na segunda tentativa @spec:AC-041', async () => {
      const email = 'reset.reuso@teste.com';
      const usuarioId = await criarUsuarioComCredencial(email, 'senha-antiga');

      const token = randomBytes(32).toString('hex');
      await db.insert(tokensVerificacao).values({
        identificador: identificadorReset(email),
        valor: token,
        expiraEm: new Date(Date.now() + 60 * 60 * 1000),
      });

      await resetarSenhaComToken(db, token, 'Senha-nova1');

      await expect(resetarSenhaComToken(db, token, 'Senha-nova2')).rejects.toThrow(
        ErroTokenResetInvalido
      );

      const credenciais = await db.select().from(contas).where(eq(contas.usuarioId, usuarioId));
      expect(verificarSenha('Senha-nova1', credenciais[0].senha!)).toBe(true);
      expect(verificarSenha('Senha-nova2', credenciais[0].senha!)).toBe(false);
    });

    test('token inexistente é recusado @spec:AC-041', async () => {
      await expect(
        resetarSenhaComToken(db, 'token-de-reset-que-nunca-existiu', 'Qualquer-senha1')
      ).rejects.toThrow(ErroTokenResetInvalido);
    });
  });

  describe('AC-042: solicitação de reset não revela se o e-mail existe', () => {
    test('resposta é idêntica para e-mail existente e inexistente @spec:AC-042', async () => {
      const emailExistente = 'reset.solicita.existente@teste.com';
      await criarUsuarioComCredencial(emailExistente, 'senha-qualquer');

      const resultadoExistente = await solicitarResetSenha(db, emailExistente);
      const resultadoInexistente = await solicitarResetSenha(db, 'nao.cadastrado@teste.com');

      expect(resultadoExistente).toEqual({ solicitado: true });
      expect(resultadoInexistente).toEqual({ solicitado: true });
      expect(resultadoExistente).toEqual(resultadoInexistente);
    });

    test('token de reset só é gerado quando o e-mail existe @spec:AC-042', async () => {
      const emailExistente = 'reset.token.existente@teste.com';
      await criarUsuarioComCredencial(emailExistente, 'senha-qualquer');
      const emailInexistente = 'reset.token.inexistente@teste.com';

      await solicitarResetSenha(db, emailExistente);
      await solicitarResetSenha(db, emailInexistente);

      const tokensExistente = await db
        .select()
        .from(tokensVerificacao)
        .where(eq(tokensVerificacao.identificador, identificadorReset(emailExistente)));
      expect(tokensExistente).toHaveLength(1);

      const tokensInexistente = await db
        .select()
        .from(tokensVerificacao)
        .where(eq(tokensVerificacao.identificador, identificadorReset(emailInexistente)));
      expect(tokensInexistente).toHaveLength(0);
    });
  });
});
