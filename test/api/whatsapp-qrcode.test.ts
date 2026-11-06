// Testes de T-087 (fase2c-whatsapp-conexao, US-050/US-051): rota GET
// /api/whatsapp/qrcode contra um Postgres 15 efêmero real e uma Evolution
// falsa local (test/support/evolution-falsa.ts). Mesmo molde de
// test/api/whatsapp-status.test.ts e test/api/whatsapp-config.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { subirEvolutionFalsa, type EvolutionFalsa } from '../support/evolution-falsa';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';

const EMPRESA_A = 'f3000000-0000-0000-0000-00000000000a'; // instância configurada, sem segredo (fluxo feliz)
const EMPRESA_B = 'f3000000-0000-0000-0000-00000000000b'; // sem instância
const EMPRESA_C = 'f3000000-0000-0000-0000-00000000000c'; // já conectada (open)
const EMPRESA_D = 'f3000000-0000-0000-0000-00000000000d'; // webhook falha
const EMPRESA_E = 'f3000000-0000-0000-0000-00000000000e'; // criar instância falha

async function loginComoCookie(auth: Auth, email: string, senha: string): Promise<string> {
  const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!sessionCookie) {
    throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
  }
  return sessionCookie.split(';')[0];
}

describe('T-087: GET /api/whatsapp/qrcode', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let evolution: EvolutionFalsa;
  let rota: typeof import('../../src/app/api/whatsapp/qrcode/route');

  let cookieMasterA: string;
  let cookieGerenteA: string;
  let cookieAtendenteA: string;
  let cookieGerenteB: string;
  let cookieGerenteC: string;
  let cookieGerenteD: string;
  let cookieGerenteE: string;

  function getQrcode(cookie: string | null, query = '', cabecalhosExtras: Record<string, string> = {}) {
    const request = new NextRequest(`http://localhost/api/whatsapp/qrcode${query}`, {
      method: 'GET',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...cabecalhosExtras },
    });
    return rota.GET(request);
  }

  function segredoGravado(empresaId: string): string | null {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT "valor" FROM "empresa_configuracoes" WHERE "empresa_id" = '${empresaId}' AND "chave" = 'evolution_webhook_secret'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    const linha = resultado.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !/^(SET|BEGIN|COMMIT|ROLLBACK|SELECT \d+)$/.test(l));
    return linha[0] ? JSON.parse(linha[0]) : null;
  }

  function contagens() {
    return {
      criar: evolution.chamadasCriarInstancia.length,
      webhook: evolution.chamadasWebhook.length,
      conectar: evolution.chamadasConectar.length,
      estado: evolution.chamadasEstado.length,
    };
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    evolution = await subirEvolutionFalsa();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A Qrcode', 'empresa-a-whatsapp-qrcode'),
         ('${EMPRESA_B}', 'Empresa B Qrcode', 'empresa-b-whatsapp-qrcode'),
         ('${EMPRESA_C}', 'Empresa C Qrcode', 'empresa-c-whatsapp-qrcode'),
         ('${EMPRESA_D}', 'Empresa D Qrcode', 'empresa-d-whatsapp-qrcode'),
         ('${EMPRESA_E}', 'Empresa E Qrcode', 'empresa-e-whatsapp-qrcode');
       INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor") VALUES
         ('${EMPRESA_A}', 'evolution_instance_name', '"instancia-a-qrcode"'::jsonb),
         ('${EMPRESA_C}', 'evolution_instance_name', '"instancia-c-qrcode"'::jsonb),
         ('${EMPRESA_D}', 'evolution_instance_name', '"instancia-d-qrcode"'::jsonb),
         ('${EMPRESA_E}', 'evolution_instance_name', '"instancia-e-qrcode"'::jsonb);`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar fixtures de whatsapp-qrcode: ${setup.stderr}`);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const ator = (empresaId: string, sufixo: string): AtorConvite => ({
      usuarioId: `ffffffff-0000-0000-0000-0000000003${sufixo}`,
      empresaId,
      papel: 'MASTER',
      isSuperAdmin: false,
    });
    const atorMasterA = ator(EMPRESA_A, 'a1');
    const atorMasterB = ator(EMPRESA_B, 'b1');
    const atorMasterC = ator(EMPRESA_C, 'c1');
    const atorMasterD = ator(EMPRESA_D, 'd1');
    const atorMasterE = ator(EMPRESA_E, 'e1');

    const conviteMasterA = await convidarUsuario(db, atorMasterA, { email: 'master.a.qrcode@teste.com', papel: 'MASTER' });
    await definirSenhaComToken(db, conviteMasterA.token, SENHA);
    const conviteGerenteA = await convidarUsuario(db, atorMasterA, { email: 'gerente.a.qrcode@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerenteA.token, SENHA);
    const conviteAtendenteA = await convidarUsuario(db, atorMasterA, {
      email: 'atendente.a.qrcode@teste.com',
      papel: 'ATENDENTE',
    });
    await definirSenhaComToken(db, conviteAtendenteA.token, SENHA);
    const conviteGerenteB = await convidarUsuario(db, atorMasterB, { email: 'gerente.b.qrcode@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerenteB.token, SENHA);
    const conviteGerenteC = await convidarUsuario(db, atorMasterC, { email: 'gerente.c.qrcode@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerenteC.token, SENHA);
    const conviteGerenteD = await convidarUsuario(db, atorMasterD, { email: 'gerente.d.qrcode@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerenteD.token, SENHA);
    const conviteGerenteE = await convidarUsuario(db, atorMasterE, { email: 'gerente.e.qrcode@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerenteE.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    process.env.EVOLUTION_API_URL = evolution.url;
    process.env.EVOLUTION_API_KEY = evolution.apiKey;
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.teste.com';
    rota = await import('../../src/app/api/whatsapp/qrcode/route');

    cookieMasterA = await loginComoCookie(auth, 'master.a.qrcode@teste.com', SENHA);
    cookieGerenteA = await loginComoCookie(auth, 'gerente.a.qrcode@teste.com', SENHA);
    cookieAtendenteA = await loginComoCookie(auth, 'atendente.a.qrcode@teste.com', SENHA);
    cookieGerenteB = await loginComoCookie(auth, 'gerente.b.qrcode@teste.com', SENHA);
    cookieGerenteC = await loginComoCookie(auth, 'gerente.c.qrcode@teste.com', SENHA);
    cookieGerenteD = await loginComoCookie(auth, 'gerente.d.qrcode@teste.com', SENHA);
    cookieGerenteE = await loginComoCookie(auth, 'gerente.e.qrcode@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    await evolution?.fechar();
    pg?.parar();
  });

  beforeEach(() => {
    evolution.definirComportamentoEstado({ tipo: 'estado', state: 'close' });
    evolution.definirComportamentoCriarInstancia({ tipo: 'sucesso' });
    evolution.definirComportamentoWebhook({ tipo: 'sucesso' });
    evolution.definirComportamentoConectar({ tipo: 'qrcode', base64: 'data:image/png;base64,qrcode-falso' });
    process.env.EVOLUTION_API_URL = evolution.url;
  });

  test('sem sessão: 401 no fluxo completo e no ?action=status, a Evolution não é chamada @spec:AC-167', async () => {
    const antes = contagens();

    const respostaCompleta = await getQrcode(null);
    expect(respostaCompleta.status).toBe(401);
    expect((await respostaCompleta.json()).codigo).toBe('NAO_AUTENTICADO');

    const respostaStatus = await getQrcode(null, '?action=status');
    expect(respostaStatus.status).toBe(401);
    expect((await respostaStatus.json()).codigo).toBe('NAO_AUTENTICADO');

    expect(contagens()).toEqual(antes);
  });

  test('?action=status sem instância cadastrada: not_configured, a Evolution não é chamada @spec:AC-175', async () => {
    const antes = contagens();

    const resposta = await getQrcode(cookieGerenteB, '?action=status');
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo).toEqual({ state: 'not_configured', instance: null });
    expect(contagens()).toEqual(antes);
  });

  test('?action=status com instância, inclusive para o atendente: estado vem da Evolution @spec:AC-176', async () => {
    evolution.definirComportamentoEstado({ tipo: 'estado', state: 'open' });

    for (const cookie of [cookieMasterA, cookieAtendenteA]) {
      const resposta = await getQrcode(cookie, '?action=status');
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo).toEqual({ state: 'open', instance: 'instancia-a-qrcode' });
    }
  });

  test('atendente não gera QR code: 403, a Evolution não é chamada (a consulta ?action=status continua permitida) @spec:AC-178', async () => {
    const antes = contagens();

    const resposta = await getQrcode(cookieAtendenteA);
    expect(resposta.status).toBe(403);
    expect((await resposta.json()).codigo).toBe('SEM_PERMISSAO');
    expect(contagens()).toEqual(antes);

    const respostaStatus = await getQrcode(cookieAtendenteA, '?action=status');
    expect(respostaStatus.status).toBe(200);
  });

  test('sem instância cadastrada, o GERENTE não tem o que conectar: 409, a Evolution não é chamada @spec:AC-179', async () => {
    const antes = contagens();

    const resposta = await getQrcode(cookieGerenteB);

    expect(resposta.status).toBe(409);
    expect((await resposta.json()).codigo).toBe('WHATSAPP_NAO_CONFIGURADO');
    expect(contagens()).toEqual(antes);
  });

  test('fluxo completo: a Evolution recebe criar, webhook e conectar nesta ordem; 200 com base64 e webhookRegistrado true @spec:AC-180', async () => {
    const resposta = await getQrcode(cookieGerenteA);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.base64).toBe('data:image/png;base64,qrcode-falso');
    expect(corpo.webhookRegistrado).toBe(true);

    const indiceCriar = evolution.ordemChamadas.lastIndexOf('criar:instancia-a-qrcode');
    const indiceWebhook = evolution.ordemChamadas.lastIndexOf('webhook:instancia-a-qrcode');
    const indiceConectar = evolution.ordemChamadas.lastIndexOf('conectar:instancia-a-qrcode');
    expect(indiceCriar).toBeGreaterThanOrEqual(0);
    expect(indiceCriar).toBeLessThan(indiceWebhook);
    expect(indiceWebhook).toBeLessThan(indiceConectar);
  });

  test('o webhook registrado leva a empresa e o segredo cadastrado; o mesmo segredo continua valendo @spec:AC-181', async () => {
    const segredo = segredoGravado(EMPRESA_A);
    expect(segredo).toBeTruthy();

    const ultimaChamada = evolution.chamadasWebhook[evolution.chamadasWebhook.length - 1];
    const corpoWebhook = ultimaChamada.corpo as { webhook: { url: string } };
    expect(corpoWebhook.webhook.url).toBe(
      `https://app.teste.com/api/whatsapp/webhook?empresa_id=${EMPRESA_A}&secret=${segredo}`
    );
  });

  test('o webhook leva o endereço pelo qual a pessoa acessa (o de cada ambiente), não o gravado na imagem no build', async () => {
    // Atrás do proxy do staging: o navegador está em staging.exemplo.com, e NEXT_PUBLIC_APP_URL (gravada no build) é de outro ambiente.
    await getQrcode(cookieGerenteA, '', { 'x-forwarded-host': 'staging.exemplo.com', 'x-forwarded-proto': 'https' });
    const segredo = segredoGravado(EMPRESA_A);
    const ultimaChamada = evolution.chamadasWebhook[evolution.chamadasWebhook.length - 1];
    const corpoWebhook = ultimaChamada.corpo as { webhook: { url: string } };
    expect(corpoWebhook.webhook.url).toBe(`https://staging.exemplo.com/api/whatsapp/webhook?empresa_id=${EMPRESA_A}&secret=${segredo}`);
    expect(corpoWebhook.webhook.url).not.toContain('app.teste.com');
  });

  test('empresa sem segredo recebe um gerado pelo servidor (>=32 bytes), reaproveitado num pedido seguinte @spec:AC-182', async () => {
    const segredoAntes = segredoGravado(EMPRESA_A);
    expect(segredoAntes).toBeTruthy();
    expect(Buffer.from(segredoAntes as string, 'hex').length).toBeGreaterThanOrEqual(32);

    await getQrcode(cookieGerenteA);
    const segredoDepois = segredoGravado(EMPRESA_A);

    expect(segredoDepois).toBe(segredoAntes);
    const ultimaChamada = evolution.chamadasWebhook[evolution.chamadasWebhook.length - 1];
    const corpoWebhook = ultimaChamada.corpo as { webhook: { url: string } };
    expect(corpoWebhook.webhook.url).toContain(`secret=${segredoAntes}`);
  });

  test('o segredo do webhook e a chave da Evolution nunca saem nas respostas @spec:AC-183', async () => {
    const segredoA = segredoGravado(EMPRESA_A);
    const respostas = await Promise.all([
      getQrcode(cookieGerenteA),
      getQrcode(cookieGerenteA, '?action=status'),
      getQrcode(cookieAtendenteA),
      getQrcode(cookieGerenteB),
    ]);

    for (const resposta of respostas) {
      const texto = JSON.stringify(await resposta.json());
      if (segredoA) expect(texto).not.toContain(segredoA);
      expect(texto.toLowerCase()).not.toContain('webhook_secret');
      expect(texto.toLowerCase()).not.toContain(evolution.apiKey.toLowerCase());
    }
  });

  test('instância já conectada: 200 { state: "open" }, sem QR code @spec:AC-184', async () => {
    evolution.definirComportamentoConectar({ tipo: 'aberto' });

    const resposta = await getQrcode(cookieGerenteC);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo).toEqual({ state: 'open' });
    expect(corpo.base64).toBeUndefined();
  });

  test('falha ao registrar o webhook não esconde o QR, mas avisa @spec:AC-185', async () => {
    evolution.definirComportamentoWebhook({ tipo: 'erro', status: 500 });

    const resposta = await getQrcode(cookieGerenteD);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.base64).toBe('data:image/png;base64,qrcode-falso');
    expect(corpo.webhookRegistrado).toBe(false);
  });

  test('falha ao criar a instância: 502, o webhook não é registrado e nenhum segredo fica gravado sem uso @spec:AC-186', async () => {
    evolution.definirComportamentoCriarInstancia({ tipo: 'erro', status: 500 });
    const antesWebhook = contagens().webhook;

    const resposta = await getQrcode(cookieGerenteE);

    expect(resposta.status).toBe(502);
    expect((await resposta.json()).codigo).toBe('FALHA_EVOLUTION');
    expect(contagens().webhook).toBe(antesWebhook);
    expect(segredoGravado(EMPRESA_E)).toBeNull();

    evolution.definirComportamentoCriarInstancia({ tipo: 'ja_existe' });
    const respostaExistente = await getQrcode(cookieGerenteE);
    const corpoExistente = await respostaExistente.json();

    expect(respostaExistente.status).toBe(200);
    expect(corpoExistente.base64).toBe('data:image/png;base64,qrcode-falso');
    expect(segredoGravado(EMPRESA_E)).toBeTruthy();
  });
});
