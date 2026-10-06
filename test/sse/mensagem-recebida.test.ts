// T-070 (fase2c-whatsapp-entrada, US-042): prova, contra um Postgres 15
// efêmero real (mesmo harness de test/sse/barramento.test.ts e
// test/sse/notify-sql.test.ts), que o barramento entrega `mensagem.recebida`
// só para quem é do mesmo tenant (AC-133) e que nenhum evento chega quando o
// INSERT que o dispara não é novo — retentativa absorvida pelo índice único
// parcial da migration 0008 (AC-124/AC-134).
//
// O contrato do payload do NOTIFY em si (`tipo`, `empresaId`, `leadId`,
// `mensagemId`, `ocorridoEm`, sem texto nem número) já tem prova própria em
// test/whatsapp/conexao-sql.test.ts (T-066); aqui o que se prova é o
// barramento como consumidor, igual ao que test/sse/barramento.test.ts já
// prova para `oportunidade.movida`.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  criarBarramento,
  type Barramento,
  type EventoBarramento,
} from '../../src/lib/sse/barramento';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA_A = 'eeeeeeee-0000-0000-0000-00000000000a';
const EMPRESA_B = 'eeeeeeee-0000-0000-0000-00000000000b';
const LEAD_A = 'eeeeeeee-0000-0000-0000-00000000001a';

async function aguardar(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function aguardarCondicao(
  condicao: () => boolean | Promise<boolean>,
  { tentativas = 50, intervaloMs = 100 }: { tentativas?: number; intervaloMs?: number } = {}
): Promise<void> {
  for (let i = 0; i < tentativas; i += 1) {
    if (await condicao()) return;
    await aguardar(intervaloMs);
  }
  if (!(await condicao())) {
    throw new Error('Condição não satisfeita dentro do tempo esperado.');
  }
}

async function contarConexoesListen(pg: PostgresEfemero): Promise<number> {
  const resultado = pg.psqlComo(
    'postgres',
    `SELECT count(*) FROM pg_stat_activity WHERE datname = '${pg.database}' AND query ILIKE 'LISTEN %'`,
    'postgres'
  );
  if (resultado.status !== 0) {
    throw new Error(`Falha ao consultar pg_stat_activity: ${resultado.stderr}`);
  }
  return Number(resultado.stdout.trim());
}

describe('T-070: Barramento de eventos — mensagem.recebida', () => {
  let pg: PostgresEfemero;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa Teste SSE A', 'empresa-teste-sse-a'),
         ('${EMPRESA_B}', 'Empresa Teste SSE B', 'empresa-teste-sse-b');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES
         ('${LEAD_A}', '${EMPRESA_A}', 'Lead Teste SSE A');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);
    }
  }, 120_000);

  afterAll(() => {
    pg?.parar();
  });

  function inserirMensagemRecebida(
    empresaId: string,
    leadId: string | null,
    numero: string,
    evolutionMessageId: string
  ): { status: number | null; stdout: string; stderr: string } {
    const leadSql = leadId ? `'${leadId}'` : 'NULL';
    return pg.psqlComo(
      'crm_app',
      `SET app.empresa_id = '${empresaId}';
       INSERT INTO "whatsapp_mensagens" ("empresa_id", "lead_id", "numero", "mensagem", "direcao", "evolution_message_id")
       VALUES ('${empresaId}', ${leadSql}, '${numero}', 'oi', 'recebida', '${evolutionMessageId}')
       ON CONFLICT ("empresa_id", "evolution_message_id") WHERE "evolution_message_id" IS NOT NULL DO NOTHING
       RETURNING "id"`
    );
  }

  describe('AC-133: mensagem recebida emite mensagem.recebida só para o tenant', () => {
    let barramento: Barramento;
    const eventosA: EventoBarramento[] = [];
    const eventosB: EventoBarramento[] = [];

    beforeAll(async () => {
      barramento = criarBarramento({ connectionString: pg.appUrl });
      barramento.inscrever(EMPRESA_A, (evento) => eventosA.push(evento));
      barramento.inscrever(EMPRESA_B, (evento) => eventosB.push(evento));
      await aguardarCondicao(() => barramento.contarInscricoes() === 2);
      await aguardarCondicao(async () => (await contarConexoesListen(pg)) === 1);
    }, 30_000);

    afterAll(async () => {
      await barramento.encerrar();
    });

    test('usuário da empresa A recebe empresaId, leadId, mensagemId e ocorridoEm; o da B não recebe nada @spec:AC-133', async () => {
      const evolutionId = 'evo-ac133-a';
      const inserida = inserirMensagemRecebida(EMPRESA_A, LEAD_A, '558599999101', evolutionId);
      expect(inserida.status).toBe(0);
      const mensagemId = inserida.stdout
        .split('\n')
        .map((linha) => linha.trim())
        .find((linha) => /^[0-9a-f-]{36}$/.test(linha));
      expect(mensagemId).toBeDefined();

      await aguardarCondicao(() => eventosA.length === 1);
      await aguardar(300);

      expect(eventosA).toHaveLength(1);
      const evento = eventosA[0];
      expect(evento.tipo).toBe('mensagem.recebida');
      if (evento.tipo !== 'mensagem.recebida') throw new Error('tipo inesperado');
      expect(evento.empresaId).toBe(EMPRESA_A);
      expect(evento.leadId).toBe(LEAD_A);
      expect(evento.mensagemId).toBe(mensagemId);
      expect(evento.ocorridoEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(eventosB).toHaveLength(0);
    });

    test('lead_id nulo chega como leadId nulo, nunca o texto ou o número @spec:AC-133', async () => {
      const evolutionId = 'evo-ac133-sem-lead';
      const inserida = inserirMensagemRecebida(EMPRESA_A, null, '558599999102', evolutionId);
      expect(inserida.status).toBe(0);

      await aguardarCondicao(() => eventosA.length === 2);
      await aguardar(300);

      const evento = eventosA[1];
      expect(evento.tipo).toBe('mensagem.recebida');
      if (evento.tipo !== 'mensagem.recebida') throw new Error('tipo inesperado');
      expect(evento.leadId).toBeNull();
      expect(JSON.stringify(evento)).not.toMatch(/oi|558599999102/);
      expect(eventosB).toHaveLength(0);
    });
  });

  describe('AC-134: mensagem ignorada ou duplicada não emite evento', () => {
    let barramento: Barramento;
    const eventos: EventoBarramento[] = [];

    beforeAll(async () => {
      barramento = criarBarramento({ connectionString: pg.appUrl });
      barramento.inscrever(EMPRESA_A, (evento) => eventos.push(evento));
      await aguardarCondicao(() => barramento.contarInscricoes() === 1);
      await aguardarCondicao(async () => (await contarConexoesListen(pg)) === 1);
    }, 30_000);

    afterAll(async () => {
      await barramento.encerrar();
    });

    test('retentativa com o mesmo evolution_message_id não dispara um segundo mensagem.recebida @spec:AC-134', async () => {
      const evolutionId = 'evo-ac134-duplicada';

      const primeira = inserirMensagemRecebida(EMPRESA_A, LEAD_A, '558599999103', evolutionId);
      expect(primeira.status).toBe(0);
      expect(primeira.stdout).toMatch(/INSERT 0 1/);

      await aguardarCondicao(() => eventos.length === 1);
      await aguardar(300);
      expect(eventos).toHaveLength(1);

      const retentativa = inserirMensagemRecebida(EMPRESA_A, LEAD_A, '558599999103', evolutionId);
      expect(retentativa.status).toBe(0);
      expect(retentativa.stdout).toMatch(/INSERT 0 0/);

      await aguardar(500);
      expect(eventos, 'a retentativa absorvida pelo índice único não deveria gerar NOTIFY').toHaveLength(1);
    });

    test('mensagem enviada por nós (direcao enviada) não dispara mensagem.recebida @spec:AC-134', async () => {
      const antes = eventos.length;
      const enviar = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_A}';
         INSERT INTO "whatsapp_mensagens" ("empresa_id", "lead_id", "numero", "mensagem", "direcao")
         VALUES ('${EMPRESA_A}', '${LEAD_A}', '558599999104', 'resposta nossa', 'enviada')`
      );
      expect(enviar.status).toBe(0);

      await aguardar(500);
      expect(eventos).toHaveLength(antes);
    });
  });
});
