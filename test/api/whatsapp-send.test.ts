// Testes de T-078 (fase2c-whatsapp-conversa, US-043/US-044): rota POST
// /api/whatsapp/send contra um Postgres 15 efêmero real e uma Evolution
// falsa local (test/support/evolution-falsa.ts, ASM-040). Mesmo molde de
// test/api/lead-telefones.test.ts.
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

const EMPRESA_A = 'f0000000-0000-0000-0000-00000000000a';
const EMPRESA_B = 'f0000000-0000-0000-0000-00000000000b';

// AC-136: lead com telefone principal, sem extras.
const LEAD_AC136 = 'f0000000-0000-0000-0000-0000000a0136';
// AC-139/AC-140: lead com principal e um extra.
const LEAD_AC139 = 'f0000000-0000-0000-0000-0000000a0139';
const TELEFONE_EXTRA_AC139 = 'f0000000-0000-0000-0000-0000000e0139';
// Outro lead da empresa A, usado só para um `telefoneId` que não pertence ao LEAD_AC139.
const LEAD_OUTRO_TELEFONE = 'f0000000-0000-0000-0000-0000000a0138';
const TELEFONE_DE_OUTRO_LEAD = 'f0000000-0000-0000-0000-0000000e0138';
// AC-138: lead sem telefone principal nem extra.
const LEAD_AC138 = LEAD_OUTRO_TELEFONE;
// AC-137: lead de outra empresa.
const LEAD_AC137_B = 'f0000000-0000-0000-0000-0000000b0137';
// AC-146: lead com oportunidade em cadência (etapa 3) e atividade pendente.
const LEAD_AC146 = 'f0000000-0000-0000-0000-0000000a0146';
const OPORTUNIDADE_AC146 = 'f0000000-0000-0000-0000-0000000c0146';
// AC-144: lead da empresa B (sem instância configurada), com telefone.
const LEAD_AC144_B = 'f0000000-0000-0000-0000-0000000b0144';

const INEXISTENTE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

async function loginComoCookie(auth: Auth, email: string, senha: string): Promise<string> {
  const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!sessionCookie) {
    throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
  }
  return sessionCookie.split(';')[0];
}

describe('T-078: POST /api/whatsapp/send', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let evolution: EvolutionFalsa;
  let rota: typeof import('../../src/app/api/whatsapp/send/route');
  let cookieA: string;
  let cookieB: string;

  function postEnvio(cookie: string | null, body: unknown) {
    const request = new NextRequest('http://localhost/api/whatsapp/send', {
      method: 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return rota.POST(request);
  }

  // `psqlComo` imprime a tag de status do comando junto com a linha de dado
  // mesmo com `-t -A` (mesmo padrão de test/repositories/whatsapp-conversa.test.ts).
  const TAG_DE_COMANDO = /^(SET|BEGIN|COMMIT|ROLLBACK|INSERT \d+ \d+|UPDATE \d+|DELETE \d+)$/;
  function valorRetornado(stdout: string): string {
    return stdout
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => linha !== '' && !TAG_DE_COMANDO.test(linha))
      .join('\n');
  }

  function contarMensagens(empresaId: string): number {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "whatsapp_mensagens" WHERE "empresa_id" = '${empresaId}' AND "direcao" = 'enviada'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    return Number(valorRetornado(resultado.stdout));
  }

  function buscarMensagem(leadId: string | null, numero: string) {
    const condicaoLead = leadId ? `"lead_id" = '${leadId}'` : '"lead_id" IS NULL';
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT "numero", "mensagem", "evolution_message_id" FROM "whatsapp_mensagens"
       WHERE ${condicaoLead} AND "numero" = '${numero}' AND "direcao" = 'enviada'
       ORDER BY "criado_em" DESC LIMIT 1`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    const linha = valorRetornado(resultado.stdout);
    if (!linha) return null;
    const [numeroGravado, mensagem, evolutionMessageId] = linha.split('|');
    return { numero: numeroGravado, mensagem, evolutionMessageId };
  }

  function estadoOportunidade(id: string): string {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT "etapa_id", "version", "cadencia_encerrada_em" IS NOT NULL FROM "oportunidades" WHERE "id" = '${id}'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    return valorRetornado(resultado.stdout);
  }

  function contarAtividadesPendentes(oportunidadeId: string): number {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "cadencia_atividades" WHERE "oportunidade_id" = '${oportunidadeId}' AND "resultado" = 'pendente'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    return Number(valorRetornado(resultado.stdout));
  }

  function contarEventos(oportunidadeId: string): number {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${oportunidadeId}'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    return Number(valorRetornado(resultado.stdout));
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    evolution = await subirEvolutionFalsa();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A Envio', 'empresa-a-envio'),
         ('${EMPRESA_B}', 'Empresa B Envio', 'empresa-b-envio');

       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES
         ('${LEAD_AC136}', '${EMPRESA_A}', 'Lead AC136', '+5585999985587'),
         ('${LEAD_AC139}', '${EMPRESA_A}', 'Lead AC139', '+5585911112222'),
         ('${LEAD_OUTRO_TELEFONE}', '${EMPRESA_A}', 'Lead Sem Telefone AC138', NULL),
         ('${LEAD_AC146}', '${EMPRESA_A}', 'Lead AC146', '+5585933334444'),
         ('${LEAD_AC137_B}', '${EMPRESA_B}', 'Lead AC137 B', '+5585955556666'),
         ('${LEAD_AC144_B}', '${EMPRESA_B}', 'Lead AC144 B', '+5585977778888');

       INSERT INTO "lead_telefones" ("id", "empresa_id", "lead_id", "numero", "rotulo") VALUES
         ('${TELEFONE_EXTRA_AC139}', '${EMPRESA_A}', '${LEAD_AC139}', '5585900001111', 'Recepção'),
         ('${TELEFONE_DE_OUTRO_LEAD}', '${EMPRESA_A}', '${LEAD_AC136}', '5585900002222', 'Financeiro');

       INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES
         ('${OPORTUNIDADE_AC146}', '${EMPRESA_A}', '${LEAD_AC146}', 3);

       INSERT INTO "cadencia_atividades"
         ("oportunidade_id", "empresa_id", "sequencia", "dia", "turno", "canal", "tipo") VALUES
         ('${OPORTUNIDADE_AC146}', '${EMPRESA_A}', 1, 1, 'manha', 'whatsapp', 'mensagem');

       INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor") VALUES
         ('${EMPRESA_A}', 'evolution_instance_name', '"instancia-empresa-a"'::jsonb);`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar fixtures de whatsapp-send: ${setup.stderr}`);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000000f1',
      empresaId: EMPRESA_A,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const atorMasterB: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000000f2',
      empresaId: EMPRESA_B,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const conviteA = await convidarUsuario(db, atorMasterA, { email: 'operador.a@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteA.token, SENHA);
    const conviteB = await convidarUsuario(db, atorMasterB, { email: 'operador.b@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteB.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    process.env.EVOLUTION_API_URL = evolution.url;
    process.env.EVOLUTION_API_KEY = evolution.apiKey;
    rota = await import('../../src/app/api/whatsapp/send/route');

    cookieA = await loginComoCookie(auth, 'operador.a@teste.com', SENHA);
    cookieB = await loginComoCookie(auth, 'operador.b@teste.com', SENHA);
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
    evolution.definirComportamento({ tipo: 'sucesso' });
    process.env.EVOLUTION_API_URL = evolution.url;
  });

  test('sem sessão: 401, Evolution não é chamada e nada é gravado @spec:AC-135', async () => {
    const antesChamadas = evolution.chamadas.length;
    const antesMensagens = contarMensagens(EMPRESA_A);

    const resposta = await postEnvio(null, { leadId: LEAD_AC136, mensagem: 'oi' });

    expect(resposta.status).toBe(401);
    expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
    expect(evolution.chamadas.length).toBe(antesChamadas);
    expect(contarMensagens(EMPRESA_A)).toBe(antesMensagens);
  });

  test('envia ao telefone principal do lead e registra enviada @spec:AC-136', async () => {
    const resposta = await postEnvio(cookieA, { leadId: LEAD_AC136, mensagem: 'olá, lead' });
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo).toMatchObject({ success: true, leadId: LEAD_AC136 });
    expect(corpo.messageId).toBeTruthy();
    expect(corpo.mensagemId).toMatch(/^[0-9a-f-]{36}$/);

    const ultimaChamada = evolution.chamadas[evolution.chamadas.length - 1];
    expect(ultimaChamada.numero).toBe('5585999985587');
    expect(ultimaChamada.texto).toBe('olá, lead');

    const gravada = buscarMensagem(LEAD_AC136, '5585999985587');
    expect(gravada).toMatchObject({ mensagem: 'olá, lead' });
    expect(gravada?.evolutionMessageId).toBe(corpo.messageId);
  });

  test('leadId de outra empresa, inexistente ou que não é UUID: 404 idêntico, sem enviar nem gravar @spec:AC-137', async () => {
    const antesChamadas = evolution.chamadas.length;
    const antesMensagens = contarMensagens(EMPRESA_A) + contarMensagens(EMPRESA_B);

    const outraEmpresa = await postEnvio(cookieA, { leadId: LEAD_AC137_B, mensagem: 'oi' });
    const inexistente = await postEnvio(cookieA, { leadId: INEXISTENTE, mensagem: 'oi' });
    const naoUuid = await postEnvio(cookieA, { leadId: 'nao-e-um-uuid', mensagem: 'oi' });

    for (const resposta of [outraEmpresa, inexistente, naoUuid]) {
      expect(resposta.status).toBe(404);
      expect((await resposta.json()).codigo).toBe('LEAD_NAO_ENCONTRADO');
    }
    expect(evolution.chamadas.length).toBe(antesChamadas);
    expect(contarMensagens(EMPRESA_A) + contarMensagens(EMPRESA_B)).toBe(antesMensagens);
  });

  test('lead sem telefone principal nem extra: 422, sem enviar nem gravar @spec:AC-138', async () => {
    const antesChamadas = evolution.chamadas.length;
    const antesMensagens = contarMensagens(EMPRESA_A);

    const resposta = await postEnvio(cookieA, { leadId: LEAD_AC138, mensagem: 'oi' });

    expect(resposta.status).toBe(422);
    expect((await resposta.json()).codigo).toBe('LEAD_SEM_TELEFONE');
    expect(evolution.chamadas.length).toBe(antesChamadas);
    expect(contarMensagens(EMPRESA_A)).toBe(antesMensagens);
  });

  test('escolhe o telefone extra pelo telefoneId; telefoneId alheio devolve 404 sem enviar @spec:AC-139', async () => {
    const resposta = await postEnvio(cookieA, {
      leadId: LEAD_AC139,
      telefoneId: TELEFONE_EXTRA_AC139,
      mensagem: 'oi, recepção',
    });
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    const ultimaChamada = evolution.chamadas[evolution.chamadas.length - 1];
    expect(ultimaChamada.numero).toBe('5585900001111');
    expect(buscarMensagem(LEAD_AC139, '5585900001111')).toMatchObject({ mensagem: 'oi, recepção' });

    // Telefone que existe, mas é de outro lead da mesma empresa.
    const antesChamadas = evolution.chamadas.length;
    const antesMensagens = contarMensagens(EMPRESA_A);
    const telefoneAlheio = await postEnvio(cookieA, {
      leadId: LEAD_AC139,
      telefoneId: TELEFONE_DE_OUTRO_LEAD,
      mensagem: 'não deveria sair',
    });
    expect(telefoneAlheio.status).toBe(404);
    expect((await telefoneAlheio.json()).codigo).toBe('TELEFONE_NAO_ENCONTRADO');
    expect(evolution.chamadas.length).toBe(antesChamadas);
    expect(contarMensagens(EMPRESA_A)).toBe(antesMensagens);
  });

  test('sem telefoneId usa o telefone principal, mesmo havendo extras @spec:AC-140', async () => {
    const resposta = await postEnvio(cookieA, { leadId: LEAD_AC139, mensagem: 'oi, principal' });
    expect(resposta.status).toBe(200);

    const ultimaChamada = evolution.chamadas[evolution.chamadas.length - 1];
    expect(ultimaChamada.numero).toBe('5585911112222');
    expect(buscarMensagem(LEAD_AC139, '5585911112222')).toMatchObject({ mensagem: 'oi, principal' });
  });

  test('número avulso sem lead correspondente: enviado e gravado com lead_id nulo @spec:AC-141', async () => {
    const numeroAvulso = '5585988889999';
    const resposta = await postEnvio(cookieA, { numero: numeroAvulso, mensagem: 'oi, desconhecido' });
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.success).toBe(true);
    expect(corpo.leadId).toBeNull();

    const gravada = buscarMensagem(null, numeroAvulso);
    expect(gravada).toMatchObject({ mensagem: 'oi, desconhecido' });
  });

  test('pedido mal formado: 400, sem chamar a Evolution nem gravar @spec:AC-143', async () => {
    const antesChamadas = evolution.chamadas.length;
    const antesMensagens = contarMensagens(EMPRESA_A);

    const semMensagem = await postEnvio(cookieA, { leadId: LEAD_AC136 });
    const mensagemEmBranco = await postEnvio(cookieA, { leadId: LEAD_AC136, mensagem: '   ' });
    const mensagemGigante = await postEnvio(cookieA, { leadId: LEAD_AC136, mensagem: 'x'.repeat(4097) });
    const semDestino = await postEnvio(cookieA, { mensagem: 'oi' });
    const leadENumeroJuntos = await postEnvio(cookieA, { leadId: LEAD_AC136, numero: '5585988887777', mensagem: 'oi' });
    const numeroCurto = await postEnvio(cookieA, { numero: '123456789', mensagem: 'oi' });
    const numeroLongo = await postEnvio(cookieA, { numero: '1'.repeat(16), mensagem: 'oi' });

    for (const resposta of [
      semMensagem,
      mensagemEmBranco,
      mensagemGigante,
      semDestino,
      leadENumeroJuntos,
      numeroCurto,
      numeroLongo,
    ]) {
      expect(resposta.status).toBe(400);
      expect((await resposta.json()).codigo).toBe('REQUISICAO_INVALIDA');
    }
    expect(evolution.chamadas.length).toBe(antesChamadas);
    expect(contarMensagens(EMPRESA_A)).toBe(antesMensagens);
  });

  test('empresa sem instância configurada: 409, sem enviar nem gravar @spec:AC-144', async () => {
    const antesChamadas = evolution.chamadas.length;
    const antesMensagens = contarMensagens(EMPRESA_B);

    const resposta = await postEnvio(cookieB, { leadId: LEAD_AC144_B, mensagem: 'oi' });

    expect(resposta.status).toBe(409);
    expect((await resposta.json()).codigo).toBe('WHATSAPP_NAO_CONFIGURADO');
    expect(evolution.chamadas.length).toBe(antesChamadas);
    expect(contarMensagens(EMPRESA_B)).toBe(antesMensagens);
  });

  describe('AC-145: falha na Evolution não deixa mensagem fantasma', () => {
    test('Evolution responde erro: 502, nada gravado @spec:AC-145', async () => {
      evolution.definirComportamento({ tipo: 'erro', status: 500 });
      const antesMensagens = contarMensagens(EMPRESA_A);

      const resposta = await postEnvio(cookieA, { leadId: LEAD_AC136, mensagem: 'vai falhar' });

      expect(resposta.status).toBe(502);
      expect((await resposta.json()).codigo).toBe('FALHA_ENVIO');
      expect(contarMensagens(EMPRESA_A)).toBe(antesMensagens);
    });

    test('Evolution fora do ar: 502, nada gravado @spec:AC-145', async () => {
      process.env.EVOLUTION_API_URL = 'http://127.0.0.1:1';
      const antesMensagens = contarMensagens(EMPRESA_A);

      const resposta = await postEnvio(cookieA, { leadId: LEAD_AC136, mensagem: 'vai falhar' });

      expect(resposta.status).toBe(502);
      expect((await resposta.json()).codigo).toBe('FALHA_ENVIO');
      expect(contarMensagens(EMPRESA_A)).toBe(antesMensagens);
    });

    test('número sem WhatsApp: 422, nada gravado @spec:AC-145', async () => {
      evolution.definirComportamento({ tipo: 'numero_sem_whatsapp' });
      const antesMensagens = contarMensagens(EMPRESA_A);

      const resposta = await postEnvio(cookieA, { leadId: LEAD_AC136, mensagem: 'vai falhar' });

      expect(resposta.status).toBe(422);
      expect((await resposta.json()).codigo).toBe('NUMERO_SEM_WHATSAPP');
      expect(contarMensagens(EMPRESA_A)).toBe(antesMensagens);
    });
  });

  test('enviar mensagem não move o card nem toca a cadência @spec:AC-146', async () => {
    const estadoAntes = estadoOportunidade(OPORTUNIDADE_AC146);
    const atividadesPendentesAntes = contarAtividadesPendentes(OPORTUNIDADE_AC146);
    const eventosAntes = contarEventos(OPORTUNIDADE_AC146);

    const resposta = await postEnvio(cookieA, { leadId: LEAD_AC146, mensagem: 'oi, em cadência' });
    expect(resposta.status).toBe(200);

    expect(estadoOportunidade(OPORTUNIDADE_AC146)).toBe(estadoAntes);
    expect(contarAtividadesPendentes(OPORTUNIDADE_AC146)).toBe(atividadesPendentesAntes);
    expect(contarEventos(OPORTUNIDADE_AC146)).toBe(eventosAntes);
  });
});
