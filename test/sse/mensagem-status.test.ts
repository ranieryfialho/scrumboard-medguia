// Os checks ao vivo: quando o webhook avança o status de uma mensagem enviada (`atualizarStatusDaMensagem`), o barramento entrega
// `mensagem.status` só para quem é da mesma empresa — contra um Postgres efêmero real, como test/sse/mensagem-recebida.test.ts.
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { criarBarramento, type Barramento, type EventoBarramento } from '../../src/lib/sse/barramento';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA_A = 'eeeeeeee-0000-0000-0000-0000000000a1';
const EMPRESA_B = 'eeeeeeee-0000-0000-0000-0000000000b1';
const LEAD_A = 'eeeeeeee-0000-0000-0000-0000000001a1';
const NUMERO = '5585999985587';

const aguardar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function aguardarCondicao(condicao: () => boolean | Promise<boolean>, tentativas = 50): Promise<void> {
  for (let i = 0; i < tentativas && !(await condicao()); i += 1) await aguardar(100);
  if (!(await condicao())) throw new Error('Condição não satisfeita dentro do tempo esperado.');
}

/** O barramento conecta no primeiro `inscrever`; só depois do LISTEN ativo um NOTIFY chega. */
function conexoesListen(pg: PostgresEfemero): number {
  const r = pg.psqlComo('postgres', `SELECT count(*) FROM pg_stat_activity WHERE datname = '${pg.database}' AND query ILIKE 'LISTEN %'`, 'postgres');
  return Number(r.stdout.trim());
}

describe('Barramento de eventos — mensagem.status (checks ao vivo)', () => {
  let pg: PostgresEfemero;
  let barramento: Barramento;
  let repositorio: typeof import('../../src/repositories/whatsapp');
  let getDb: typeof import('../../src/db/client').getDb;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa Status A', 'empresa-status-a'),
         ('${EMPRESA_B}', 'Empresa Status B', 'empresa-status-b');
       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES
         ('${LEAD_A}', '${EMPRESA_A}', 'Lead A', '+${NUMERO}');`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);

    process.env.DATABASE_URL = pg.appUrl;
    repositorio = await import('../../src/repositories/whatsapp');
    ({ getDb } = await import('../../src/db/client'));
    barramento = criarBarramento({ connectionString: pg.appUrl });
  }, 120_000);

  afterAll(async () => {
    await barramento?.encerrar();
    await (getDb() as unknown as { $client: Pool }).$client.end();
    pg?.parar();
  });

  test('o aviso chega ao tenant certo com o status e o lead, e não vaza para outra empresa', async () => {
    const deA: EventoBarramento[] = [];
    const deB: EventoBarramento[] = [];
    barramento.inscrever(EMPRESA_A, (e) => deA.push(e));
    barramento.inscrever(EMPRESA_B, (e) => deB.push(e));
    await aguardarCondicao(() => conexoesListen(pg) >= 1);

    const { mensagemId } = await repositorio.registrarMensagemEnviada(
      getDb(),
      { empresaId: EMPRESA_A },
      { numero: NUMERO, texto: 'oi', evolutionMessageId: 'evo-sse-1' }
    );
    await repositorio.atualizarStatusDaMensagem(getDb(), { empresaId: EMPRESA_A }, { evolutionMessageId: 'evo-sse-1', status: 'entregue' });

    await aguardarCondicao(() => deA.some((e) => e.tipo === 'mensagem.status'));
    expect(deA.find((e) => e.tipo === 'mensagem.status')).toEqual({
      tipo: 'mensagem.status',
      empresaId: EMPRESA_A,
      leadId: LEAD_A,
      mensagemId,
      status: 'entregue',
    });

    await aguardar(500);
    expect(deB).toEqual([]);
  });

  test('aviso que não muda nada (status igual ou mais baixo) não gera evento', async () => {
    const recebidos: EventoBarramento[] = [];
    barramento.inscrever(EMPRESA_A, (e) => recebidos.push(e));

    await repositorio.registrarMensagemEnviada(getDb(), { empresaId: EMPRESA_A }, { numero: NUMERO, texto: 'oi 2', evolutionMessageId: 'evo-sse-2' });
    await repositorio.atualizarStatusDaMensagem(getDb(), { empresaId: EMPRESA_A }, { evolutionMessageId: 'evo-sse-2', status: 'lida' });
    await aguardarCondicao(() => recebidos.some((e) => e.tipo === 'mensagem.status'));
    const antes = recebidos.length;

    await repositorio.atualizarStatusDaMensagem(getDb(), { empresaId: EMPRESA_A }, { evolutionMessageId: 'evo-sse-2', status: 'entregue' });
    await aguardar(500);
    expect(recebidos.length).toBe(antes);
  });
});
