// Testes de T-145 (fase4-design-system-shell-acesso, US-100/US-101/US-102):
// APIs das telas públicas de esqueci-senha, redefinir-senha e convite —
// mesmo molde de test/api/auth-http.test.ts (Postgres 15 efêmero real; as
// rotas usam `getDb()`/`getAuth()` (singletons), então os módulos de rota só
// podem ser importados DEPOIS de `DATABASE_URL` apontar pro Postgres
// efêmero, daí o `await import(...)` dinâmico dentro de `beforeAll`).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { contas, empresas, sessoes, tokensVerificacao, usuarios } from '../../src/db/schema';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken, verificarSenha } from '../../src/lib/auth/definir-senha';
import { identificadorReset } from '../../src/lib/auth/reset-senha';

const BASE_URL = 'http://localhost:3000';
const EMPRESA_ID = 'eeeeeeee-0000-0000-0000-0000000000a9';
const EMPRESA_NOME = 'Clínica São Lucas';
const ATOR_MASTER: AtorConvite = {
  usuarioId: 'ffffffff-0000-0000-0000-0000000000f9',
  empresaId: EMPRESA_ID,
  papel: 'MASTER',
  isSuperAdmin: false,
};

describe('T-145: APIs das telas públicas: esqueci, redefinir e convite', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let esqueciSenhaModule: typeof import('../../src/app/api/acesso/esqueci-senha/route');
  let redefinirSenhaModule: typeof import('../../src/app/api/acesso/redefinir-senha/[token]/route');
  let conviteModule: typeof import('../../src/app/api/acesso/convite/[token]/route');

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${EMPRESA_ID}', '${EMPRESA_NOME}', 'clinica-sao-lucas-acesso');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de acesso: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);

    // As rotas leem `getDb()`/`getAuth()` (singletons) — precisam apontar pro
    // Postgres efêmero ANTES do primeiro import desses módulos.
    process.env.DATABASE_URL = pg.appUrl;
    esqueciSenhaModule = await import('../../src/app/api/acesso/esqueci-senha/route');
    redefinirSenhaModule = await import('../../src/app/api/acesso/redefinir-senha/[token]/route');
    conviteModule = await import('../../src/app/api/acesso/convite/[token]/route');
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  async function criarUsuarioAtivoComCredencial(email: string, senha: string, papel: AtorConvite['papel'] = 'ATENDENTE') {
    const convite = await convidarUsuario(db, ATOR_MASTER, { email, papel });
    await definirSenhaComToken(db, convite.token, senha);
    return convite.usuarioId;
  }

  async function inserirTokenReset(email: string, opcoes: { expiraEm?: Date } = {}) {
    const token = randomBytes(32).toString('hex');
    await db.insert(tokensVerificacao).values({
      identificador: identificadorReset(email),
      valor: token,
      expiraEm: opcoes.expiraEm ?? new Date(Date.now() + 60 * 60 * 1000),
    });
    return token;
  }

  function postJson(url: string, corpo: unknown, headers: Record<string, string> = {}) {
    return new NextRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(corpo),
    });
  }

  describe('AC-364: a confirmação é a mesma para qualquer e-mail', () => {
    test('e-mail cadastrado e inexistente recebem a mesma resposta @spec:AC-364', async () => {
      const email = 'ac364.existente@teste.com';
      await criarUsuarioAtivoComCredencial(email, 'Senha-antiga1');

      const respostaExistente = await esqueciSenhaModule.POST(
        postJson(`${BASE_URL}/api/acesso/esqueci-senha`, { email }, { 'x-forwarded-for': 'ac364-ip-1' })
      );
      const respostaInexistente = await esqueciSenhaModule.POST(
        postJson(
          `${BASE_URL}/api/acesso/esqueci-senha`,
          { email: 'ac364.inexistente@teste.com' },
          { 'x-forwarded-for': 'ac364-ip-2' }
        )
      );

      expect(respostaExistente.status).toBe(200);
      expect(respostaInexistente.status).toBe(200);
      expect(await respostaExistente.json()).toEqual({ solicitado: true });
      expect(await respostaInexistente.json()).toEqual({ solicitado: true });
    });
  });

  describe('AC-365: o e-mail só é enviado quando a conta existe', () => {
    const fetchOriginal = global.fetch;

    beforeEach(() => {
      process.env.RESEND_API_KEY = 'chave-teste-ac365';
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    });

    afterEach(() => {
      delete process.env.RESEND_API_KEY;
      global.fetch = fetchOriginal;
      vi.restoreAllMocks();
    });

    test('conta cadastrada e ativa: envia o e-mail marcado MedCRM com o link do token @spec:AC-365', async () => {
      const email = 'ac365.ativo@teste.com';
      await criarUsuarioAtivoComCredencial(email, 'Senha-antiga1');

      await esqueciSenhaModule.POST(
        postJson(`${BASE_URL}/api/acesso/esqueci-senha`, { email }, { 'x-forwarded-for': 'ac365-ip-1' })
      );

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const corpo = JSON.parse((init as RequestInit).body as string);
      expect(corpo.to).toEqual([email]);
      expect(corpo.subject).toContain('MedCRM');
      expect(corpo.html).toContain('/redefinir-senha/');
    });

    test('e-mail inexistente: nenhum e-mail é enviado @spec:AC-365', async () => {
      await esqueciSenhaModule.POST(
        postJson(
          `${BASE_URL}/api/acesso/esqueci-senha`,
          { email: 'ac365.inexistente@teste.com' },
          { 'x-forwarded-for': 'ac365-ip-2' }
        )
      );

      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('usuário inativo: nenhum e-mail é enviado @spec:AC-365', async () => {
      const email = 'ac365.inativo@teste.com';
      await criarUsuarioAtivoComCredencial(email, 'Senha-antiga1');
      const desativar = pg.psqlComo('crm_migrator', `UPDATE "usuarios" SET "ativo" = false WHERE "email" = '${email}';`);
      if (desativar.status !== 0) throw new Error(`Falha ao desativar usuário: ${desativar.stderr}`);

      await esqueciSenhaModule.POST(
        postJson(`${BASE_URL}/api/acesso/esqueci-senha`, { email }, { 'x-forwarded-for': 'ac365-ip-3' })
      );

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('AC-370: link expirado ou já usado mostra a tela de erro, sem pedir senha', () => {
    test('GET com token válido confirma sem consumir o token @spec:AC-370', async () => {
      const email = 'ac370.valido@teste.com';
      await criarUsuarioAtivoComCredencial(email, 'Senha-antiga1');
      const token = await inserirTokenReset(email);

      const resposta = await redefinirSenhaModule.GET(new NextRequest(`${BASE_URL}/api/acesso/redefinir-senha/${token}`), {
        params: Promise.resolve({ token }),
      });

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({ valido: true });

      const linhas = await db.select().from(tokensVerificacao).where(eq(tokensVerificacao.valor, token));
      expect(linhas).toHaveLength(1);
    });

    test('GET com token expirado mostra o erro, sem formulário @spec:AC-370', async () => {
      const email = 'ac370.expirado@teste.com';
      await criarUsuarioAtivoComCredencial(email, 'Senha-antiga1');
      const token = await inserirTokenReset(email, { expiraEm: new Date(Date.now() - 60_000) });

      const resposta = await redefinirSenhaModule.GET(new NextRequest(`${BASE_URL}/api/acesso/redefinir-senha/${token}`), {
        params: Promise.resolve({ token }),
      });

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ codigo: 'TOKEN_INVALIDO' });
    });

    test('GET com token inexistente mostra o erro @spec:AC-370', async () => {
      const resposta = await redefinirSenhaModule.GET(
        new NextRequest(`${BASE_URL}/api/acesso/redefinir-senha/token-nunca-existiu`),
        { params: Promise.resolve({ token: 'token-nunca-existiu' }) }
      );

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ codigo: 'TOKEN_INVALIDO' });
    });

    test('token já usado (consumido pelo POST) mostra o erro no GET seguinte @spec:AC-370', async () => {
      const email = 'ac370.usado@teste.com';
      await criarUsuarioAtivoComCredencial(email, 'Senha-antiga1');
      const token = await inserirTokenReset(email);

      const respostaPost = await redefinirSenhaModule.POST(
        postJson(`${BASE_URL}/api/acesso/redefinir-senha/${token}`, { senha: 'Senha-nova1' }),
        { params: Promise.resolve({ token }) }
      );
      expect(respostaPost.status).toBe(200);

      const respostaGet = await redefinirSenhaModule.GET(new NextRequest(`${BASE_URL}/api/acesso/redefinir-senha/${token}`), {
        params: Promise.resolve({ token }),
      });
      expect(respostaGet.status).toBe(404);
      expect(await respostaGet.json()).toEqual({ codigo: 'TOKEN_INVALIDO' });
    });
  });

  describe('AC-369: salvar troca a senha e já entra no sistema', () => {
    test('token válido e senha dentro da política trocam a credencial, revogam sessões antigas e criam uma sessão nova @spec:AC-369', async () => {
      const email = 'ac369.redefine@teste.com';
      const usuarioId = await criarUsuarioAtivoComCredencial(email, 'Senha-antiga1');
      await db.insert(sessoes).values({
        usuarioId,
        token: randomBytes(32).toString('hex'),
        expiraEm: new Date(Date.now() + 60 * 60 * 1000),
      });
      const token = await inserirTokenReset(email);

      const resposta = await redefinirSenhaModule.POST(
        postJson(`${BASE_URL}/api/acesso/redefinir-senha/${token}`, { senha: 'Senha-nova1' }),
        { params: Promise.resolve({ token }) }
      );

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({ ok: true });

      const cookies = resposta.headers.getSetCookie();
      expect(cookies.some((c) => c.includes('better-auth.session_token='))).toBe(true);

      const credenciais = await db.select().from(contas).where(eq(contas.usuarioId, usuarioId));
      expect(verificarSenha('Senha-nova1', credenciais[0].senha!)).toBe(true);
      expect(verificarSenha('Senha-antiga1', credenciais[0].senha!)).toBe(false);

      const sessoesDepois = await db.select().from(sessoes).where(eq(sessoes.usuarioId, usuarioId));
      expect(sessoesDepois).toHaveLength(1);

      const tokensRestantes = await db.select().from(tokensVerificacao).where(eq(tokensVerificacao.valor, token));
      expect(tokensRestantes).toHaveLength(0);
    });
  });

  describe('AC-371: a tela mostra para quem é o convite', () => {
    test('GET com convite válido mostra a empresa, o papel e o e-mail, sem consumir o token @spec:AC-371', async () => {
      const email = 'dra.juliana@saolucas.med.br';
      const convite = await convidarUsuario(db, ATOR_MASTER, { email, papel: 'ATENDENTE' });

      const resposta = await conviteModule.GET(new NextRequest(`${BASE_URL}/api/acesso/convite/${convite.token}`), {
        params: Promise.resolve({ token: convite.token }),
      });

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({
        valido: true,
        email,
        papel: 'ATENDENTE',
        empresa: { id: EMPRESA_ID, nome: EMPRESA_NOME },
      });

      const linhas = await db.select().from(tokensVerificacao).where(eq(tokensVerificacao.valor, convite.token));
      expect(linhas).toHaveLength(1);
    });
  });

  describe('AC-373: ativar cria a senha, grava o nome e entra', () => {
    test('convite válido com nome e senha ativa a conta, grava o nome e cria a sessão @spec:AC-373', async () => {
      const email = 'ac373.ativa@teste.com';
      const convite = await convidarUsuario(db, ATOR_MASTER, { email, papel: 'ATENDENTE' });

      const resposta = await conviteModule.POST(
        postJson(`${BASE_URL}/api/acesso/convite/${convite.token}`, { nome: 'Dra. Juliana', senha: 'Senha-nova1' }),
        { params: Promise.resolve({ token: convite.token }) }
      );

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({ ok: true });

      const cookies = resposta.headers.getSetCookie();
      expect(cookies.some((c) => c.includes('better-auth.session_token='))).toBe(true);

      const [usuario] = await db.select().from(usuarios).where(eq(usuarios.id, convite.usuarioId));
      expect(usuario.nome).toBe('Dra. Juliana');

      const credenciais = await db.select().from(contas).where(eq(contas.usuarioId, convite.usuarioId));
      expect(verificarSenha('Senha-nova1', credenciais[0].senha!)).toBe(true);

      const sessoesDepois = await db.select().from(sessoes).where(eq(sessoes.usuarioId, convite.usuarioId));
      expect(sessoesDepois).toHaveLength(1);

      const tokensRestantes = await db
        .select()
        .from(tokensVerificacao)
        .where(eq(tokensVerificacao.valor, convite.token));
      expect(tokensRestantes).toHaveLength(0);
    });
  });

  describe('AC-374: convite inválido mostra o erro sem vazar dados da empresa', () => {
    test('GET com convite expirado mostra o erro genérico, sem empresa nem e-mail @spec:AC-374', async () => {
      const email = 'ac374.expirado@teste.com';
      const convite = await convidarUsuario(db, ATOR_MASTER, { email, papel: 'ATENDENTE' }, { ttlMs: -1 });

      const resposta = await conviteModule.GET(new NextRequest(`${BASE_URL}/api/acesso/convite/${convite.token}`), {
        params: Promise.resolve({ token: convite.token }),
      });

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ codigo: 'CONVITE_INVALIDO' });
    });

    test('GET com convite inexistente mostra o erro genérico @spec:AC-374', async () => {
      const resposta = await conviteModule.GET(new NextRequest(`${BASE_URL}/api/acesso/convite/token-nunca-existiu`), {
        params: Promise.resolve({ token: 'token-nunca-existiu' }),
      });

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ codigo: 'CONVITE_INVALIDO' });
    });

    test('convite já usado mostra o erro genérico no GET seguinte @spec:AC-374', async () => {
      const email = 'ac374.usado@teste.com';
      const convite = await convidarUsuario(db, ATOR_MASTER, { email, papel: 'ATENDENTE' });

      await conviteModule.POST(postJson(`${BASE_URL}/api/acesso/convite/${convite.token}`, { nome: 'Nome', senha: 'Senha-nova1' }), {
        params: Promise.resolve({ token: convite.token }),
      });

      const resposta = await conviteModule.GET(new NextRequest(`${BASE_URL}/api/acesso/convite/${convite.token}`), {
        params: Promise.resolve({ token: convite.token }),
      });

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ codigo: 'CONVITE_INVALIDO' });
    });
  });
});
