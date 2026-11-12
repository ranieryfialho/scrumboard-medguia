// fase6-periodo-personalizado (US-195): o período (De/Até + qual data) na lista e nos arquivados do pipeline, contra um
// Postgres 15 efêmero real com as migrations aplicadas (mesmo harness de test/repositories/pipeline-lista.test.ts).
// Cada teste usa a própria empresa, então o isolamento entre empresas também fica provado pelos totais fixos.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { listarArquivados, listarLista } from '../../src/repositories/pipeline-lista';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const ETAPA_ENTRADA = 1;
const ETAPA_PROPOSTA = 11;
const ETAPA_PERDIDO = 14;
const ETAPA_GANHO = 15;

const USUARIO_SESSAO = 'aaaaaaaa-0000-0000-0000-000000000001';

function contextoDe(empresaId: string): ContextoTenant {
  return { usuarioId: USUARIO_SESSAO, empresaId, papel: 'GERENTE', isSuperAdmin: false };
}

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `dddddddd-6666-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

describe('fase6-periodo-personalizado: período na lista e nos arquivados', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  function executar(sqlTexto: string): string {
    const resultado = pg.psqlComo('crm_migrator', sqlTexto);
    if (resultado.status !== 0) throw new Error(`Falha ao executar fixture: ${resultado.stderr}`);
    return resultado.stdout.trim();
  }

  let contadorEmpresa = 0;
  function criarEmpresa(): string {
    contadorEmpresa += 1;
    const id = proximoUuid();
    executar(`INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${id}', 'Empresa Periodo ${contadorEmpresa}', 'empresa-periodo-${contadorEmpresa}')`);
    return id;
  }

  function criarCard(empresaId: string, nome: string, etapaId: number, criadoEm: string): string {
    const leadId = proximoUuid();
    executar(`INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${leadId}', '${empresaId}', '${nome}')`);
    const id = proximoUuid();
    executar(
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "criado_em") VALUES ('${id}', '${empresaId}', '${leadId}', ${etapaId}, '${criadoEm}'::timestamptz)`
    );
    return id;
  }

  function evento(empresaId: string, oportunidadeId: string, tipo: 'transicao_etapa' | 'migrado_de', etapaDestinoId: number | null, ocorridoEm: string): void {
    executar(
      `INSERT INTO "oportunidade_eventos" ("empresa_id", "oportunidade_id", "tipo", "etapa_destino_id", "ator_tipo", "ocorrido_em")
       VALUES ('${empresaId}', '${oportunidadeId}', '${tipo}', ${etapaDestinoId ?? 'NULL'}, '${tipo === 'migrado_de' ? 'migracao' : 'sistema'}', '${ocorridoEm}'::timestamptz)`
    );
  }

  const idsDaLista = async (empresaId: string, filtro: Parameters<typeof listarLista>[2]) =>
    (await listarLista(db, contextoDe(empresaId), { porPagina: 100, ...filtro })).itens.map((i) => i.id).sort();
  const idsDosArquivados = async (empresaId: string, filtro: Parameters<typeof listarArquivados>[2]) =>
    (await listarArquivados(db, contextoDe(empresaId), { porPagina: 100, ...filtro })).itens.map((i) => i.id).sort();

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  test('a lista filtra pela entrada do lead, com os dias inclusivos em São Paulo e só da empresa @spec:AC-821 @spec:AC-822', async () => {
    const empresa = criarEmpresa();
    const outra = criarEmpresa();
    const dentro1 = criarCard(empresa, 'Dentro 1', ETAPA_ENTRADA, '2026-02-05T10:00:00-03:00');
    const dentro2 = criarCard(empresa, 'Dentro 2', ETAPA_PROPOSTA, '2026-02-28T23:30:00-03:00'); // último minuto do último dia
    criarCard(empresa, 'Depois', ETAPA_ENTRADA, '2026-03-01T00:30:00-03:00');
    criarCard(empresa, 'Antes', ETAPA_ENTRADA, '2026-01-31T23:30:00-03:00');
    criarCard(outra, 'De outra empresa', ETAPA_ENTRADA, '2026-02-10T10:00:00-03:00');

    expect(await idsDaLista(empresa, { de: '2026-02-01', ate: '2026-02-28' })).toEqual([dentro1, dentro2].sort());
    expect(await idsDaLista(empresa, { de: '2026-02-01', ate: '2026-02-28', data: 'entrada' })).toEqual([dentro1, dentro2].sort());
    // só `de` ou só `ate` também valem
    expect((await idsDaLista(empresa, { de: '2026-03-01' })).length).toBe(1);
    expect((await idsDaLista(empresa, { ate: '2026-01-31' })).length).toBe(1);
    // sem período, nada é filtrado
    expect((await idsDaLista(empresa, {})).length).toBe(4);
  });

  test('o funil enxerga os arquivados pela entrada do lead, em Perdido e em Ganho @spec:AC-821 @spec:AC-823', async () => {
    const empresa = criarEmpresa();
    const perdido = criarCard(empresa, 'Perdido de fevereiro', ETAPA_PERDIDO, '2026-02-10T10:00:00-03:00');
    const ganho = criarCard(empresa, 'Ganho de fevereiro', ETAPA_GANHO, '2026-02-12T10:00:00-03:00');
    criarCard(empresa, 'Perdido de abril', ETAPA_PERDIDO, '2026-04-10T10:00:00-03:00');
    evento(empresa, perdido, 'transicao_etapa', ETAPA_PERDIDO, '2026-03-15T10:00:00-03:00');
    evento(empresa, ganho, 'transicao_etapa', ETAPA_GANHO, '2026-03-20T10:00:00-03:00');

    expect(await idsDosArquivados(empresa, { de: '2026-02-01', ate: '2026-02-28', data: 'entrada' })).toEqual([perdido, ganho].sort());
  });

  test('"última movimentação" usa a última mudança de etapa e o arquivado fechado em março sai do filtro de entrada @spec:AC-823 @spec:AC-825', async () => {
    const empresa = criarEmpresa();
    const perdido = criarCard(empresa, 'Perdido em março', ETAPA_PERDIDO, '2026-01-10T10:00:00-03:00');
    evento(empresa, perdido, 'transicao_etapa', ETAPA_PERDIDO, '2026-03-15T10:00:00-03:00');

    const marco = { de: '2026-03-01', ate: '2026-03-31' };
    expect(await idsDosArquivados(empresa, { ...marco, data: 'movimentacao' })).toEqual([perdido]);
    expect(await idsDosArquivados(empresa, { ...marco, data: 'entrada' })).toEqual([]);
    // sem `data`, o período continua sendo o de fechamento, como sempre foi (compatível com quem já chama a rota)
    expect(await idsDosArquivados(empresa, marco)).toEqual([perdido]);
  });

  test('"última movimentação": card movido usa a data da mudança; card migrado sem mudança cai na entrada, nunca na data da migração @spec:AC-825', async () => {
    const empresa = criarEmpresa();
    const movido = criarCard(empresa, 'Movido', ETAPA_PROPOSTA, '2026-01-01T10:00:00-03:00');
    evento(empresa, movido, 'transicao_etapa', 3, '2026-02-01T10:00:00-03:00');
    evento(empresa, movido, 'transicao_etapa', ETAPA_PROPOSTA, '2026-03-10T10:00:00-03:00');
    const migrado = criarCard(empresa, 'Migrado', ETAPA_ENTRADA, '2026-01-20T10:00:00-03:00');
    evento(empresa, migrado, 'migrado_de', null, new Date().toISOString());

    const mov = (de: string, ate: string) => idsDaLista(empresa, { de, ate, data: 'movimentacao' });
    expect(await mov('2026-03-01', '2026-03-31')).toEqual([movido]); // a última mudança, não a primeira
    expect(await mov('2026-02-01', '2026-02-28')).toEqual([]); // a mudança de fevereiro foi substituída pela de março
    expect(await mov('2026-01-15', '2026-01-25')).toEqual([migrado]); // sem mudança de etapa: a entrada
    const hoje = new Date().toISOString().slice(0, 10);
    expect(await mov(hoje, hoje)).toEqual([]); // o dia da migração (e do `atualizado_em`) não conta
  });
});
