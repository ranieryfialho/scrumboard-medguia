// Testes de T-111 (fase3-etl-supabase, US-071): migração de campanhas e
// envios (src/etl/supabase/campanhas.ts). Contra Postgres real (mesmo
// harness de T-108/T-109/T-110) porque precisamos provar status, vínculo e
// idempotência exatamente como a migração deveria gravá-los — um mock não
// prova isso.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { executarEtl, type ContextoExecucao } from '../../src/etl/comum';
import {
  migrarCampanhas,
  type CampanhaLegado,
  type EnvioLegado,
} from '../../src/etl/supabase/campanhas';
import { migrarEmpresas } from '../../src/etl/supabase/identidade';
import { campanhas, empresas, enviosCampanha, migracaoRegistros } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-111: migração de campanhas e envios contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const contexto: ContextoExecucao = { origem: 'supabase-legado', simulacao: false };

  const empresaA = { id: '10000000-0000-0000-0000-000000000001', nome: 'Clínica A', slug: 'clinica-a' };

  function campanha(parcial: Partial<CampanhaLegado> & { id: string }): CampanhaLegado {
    return {
      empresaId: empresaA.id,
      nome: 'Campanha ' + parcial.id,
      assunto: 'Assunto',
      corpoHtml: '<p>corpo</p>',
      status: 'FINALIZADA',
      criadoPor: null,
      ...parcial,
    };
  }

  function envio(parcial: Partial<EnvioLegado> & { id: string; campanhaId: string }): EnvioLegado {
    return {
      empresaId: empresaA.id,
      nomeDestinatario: 'Destinatário ' + parcial.id,
      emailDestinatario: 'destinatario@exemplo.com',
      status: 'ENVIADO',
      tentativas: 1,
      ...parcial,
    };
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.migratorUrl });
    db = drizzle(pool);
    await db.execute('DELETE FROM migracao_registros');
    await db.delete(enviosCampanha);
    await db.delete(campanhas);
    await db.delete(empresas);
    await executarEtl(db, contexto, (tx, ctx) => migrarEmpresas(tx, ctx, [empresaA]));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  beforeEach(async () => {
    await db.delete(enviosCampanha);
    await db.delete(campanhas);
    await db.execute("DELETE FROM migracao_registros WHERE entidade IN ('campanha', 'envio_campanha')");
  });

  test('envios migram ligados à campanha, com nome/e-mail/status preservados, e a quantidade bate com a origem (@spec:AC-261)', async () => {
    const legada = campanha({ id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'FINALIZADA' });
    const envios = [
      envio({
        id: 'bbbbbbbb-0000-0000-0000-000000000001',
        campanhaId: legada.id,
        nomeDestinatario: 'Maria Silva',
        emailDestinatario: 'maria@exemplo.com',
        status: 'ENVIADO',
      }),
      envio({
        id: 'bbbbbbbb-0000-0000-0000-000000000002',
        campanhaId: legada.id,
        nomeDestinatario: 'João Souza',
        emailDestinatario: 'joao@exemplo.com',
        status: 'ERRO',
      }),
      envio({
        id: 'bbbbbbbb-0000-0000-0000-000000000003',
        campanhaId: legada.id,
        nomeDestinatario: 'Ana Costa',
        emailDestinatario: 'ana@exemplo.com',
        status: 'CLICADO',
      }),
    ];

    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      migrarCampanhas(tx, ctx, [legada], envios)
    );

    expect(resultado.campanhas).toMatchObject({ lidas: 1, criadas: 1, ignoradas: 0 });
    expect(resultado.envios).toMatchObject({ lidas: 3, criadas: 3, ignoradas: 0 });

    const [campanhaDestino] = await db.select().from(campanhas).where(eq(campanhas.id, legada.id));
    expect(campanhaDestino).toMatchObject({ nome: legada.nome, status: 'FINALIZADA' });

    const enviosDestino = await db
      .select()
      .from(enviosCampanha)
      .where(eq(enviosCampanha.campanhaId, legada.id));
    expect(enviosDestino).toHaveLength(3);

    for (const envioOrigem of envios) {
      const envioDestino = enviosDestino.find((linha) => linha.id === envioOrigem.id);
      expect(envioDestino).toMatchObject({
        campanhaId: legada.id,
        nomeDestinatario: envioOrigem.nomeDestinatario,
        emailDestinatario: envioOrigem.emailDestinatario,
        status: envioOrigem.status,
      });
    }

    for (const envioOrigem of envios) {
      const [registro] = await db
        .select()
        .from(migracaoRegistros)
        .where(
          and(
            eq(migracaoRegistros.origem, contexto.origem),
            eq(migracaoRegistros.idExterno, envioOrigem.id)
          )
        );
      expect(registro).toMatchObject({ entidade: 'envio_campanha', idDestino: envioOrigem.id });
    }
  });

  test('campanha PROCESSANDO no legado migra FINALIZADA e nenhum envio fica PENDENTE ou RASCUNHO (@spec:AC-262)', async () => {
    const legada = campanha({ id: 'cccccccc-0000-0000-0000-000000000001', status: 'PROCESSANDO' });
    const envios = [
      envio({
        id: 'dddddddd-0000-0000-0000-000000000001',
        campanhaId: legada.id,
        status: 'ENVIADO',
      }),
      envio({
        id: 'dddddddd-0000-0000-0000-000000000002',
        campanhaId: legada.id,
        status: 'PENDENTE',
      }),
      envio({
        id: 'dddddddd-0000-0000-0000-000000000003',
        campanhaId: legada.id,
        status: 'RASCUNHO',
      }),
    ];

    await executarEtl(db, contexto, (tx, ctx) => migrarCampanhas(tx, ctx, [legada], envios));

    const [campanhaDestino] = await db.select().from(campanhas).where(eq(campanhas.id, legada.id));
    expect(campanhaDestino.status).toBe('FINALIZADA');

    const enviosDestino = await db
      .select()
      .from(enviosCampanha)
      .where(eq(enviosCampanha.campanhaId, legada.id));

    const pendentesOuRascunho = enviosDestino.filter(
      (linha) => linha.status === 'PENDENTE' || linha.status === 'RASCUNHO'
    );
    expect(pendentesOuRascunho).toHaveLength(0);

    const enviadoOriginal = enviosDestino.find((linha) => linha.id === envios[0].id);
    expect(enviadoOriginal?.status).toBe('ENVIADO');

    const eraPendente = enviosDestino.find((linha) => linha.id === envios[1].id);
    expect(eraPendente?.status).toBe('ERRO');

    const eraRascunho = enviosDestino.find((linha) => linha.id === envios[2].id);
    expect(eraRascunho?.status).toBe('ERRO');
  });

  test('rodar de novo sobre a mesma campanha e os mesmos envios não duplica nada', async () => {
    const legada = campanha({ id: 'eeeeeeee-0000-0000-0000-000000000001', status: 'FINALIZADA' });
    const envios = [
      envio({ id: 'ffffffff-0000-0000-0000-000000000001', campanhaId: legada.id, status: 'ENVIADO' }),
    ];

    await executarEtl(db, contexto, (tx, ctx) => migrarCampanhas(tx, ctx, [legada], envios));
    const resultado = await executarEtl(db, contexto, (tx, ctx) => migrarCampanhas(tx, ctx, [legada], envios));

    expect(resultado.campanhas).toMatchObject({ lidas: 1, criadas: 0, ignoradas: 1 });
    expect(resultado.envios).toMatchObject({ lidas: 1, criadas: 0, ignoradas: 1 });

    const campanhasDestino = await db.select().from(campanhas).where(eq(campanhas.id, legada.id));
    expect(campanhasDestino).toHaveLength(1);
    const enviosDestino = await db
      .select()
      .from(enviosCampanha)
      .where(eq(enviosCampanha.campanhaId, legada.id));
    expect(enviosDestino).toHaveLength(1);
  });
});
