// T-181 (fase4-tarefas-agenda, US-119): indicadores da fila (AC-462, AC-463),
// filtro por responsável (AC-468) e liberação/responsável em cada item (AC-469),
// contra um Postgres efêmero real. O relógio é injetado (ASM-062).
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { listarFilaDoTurno } from '../../src/repositories/cadencia';
import { resumoDoTurno } from '../../src/repositories/resumo-turno';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

vi.mock('@/lib/auth/instancia', () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }));
vi.mock('../../src/lib/auth/instancia', () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }));

const EMPRESA_A = 'bbbbbbbb-f181-0000-0000-00000000000a';
const EMPRESA_B = 'bbbbbbbb-f181-0000-0000-00000000000b';
const ANA = 'bbbbbbbb-f181-0000-0000-0000000000a1';
const BIA = 'bbbbbbbb-f181-0000-0000-0000000000a2';
const LEAD = (n: number) => `bbbbbbbb-f181-0000-0000-0000000001${String(n).padStart(2, '0')}`;
const CARD = (n: number) => `bbbbbbbb-f181-0000-0000-0000000002${String(n).padStart(2, '0')}`;

// quinta-feira, 11/06/2026, 09h em São Paulo: turno da manhã.
const AGORA = new Date('2026-06-11T09:00:00-03:00');
const gerente: ContextoTenant = { usuarioId: ANA, empresaId: EMPRESA_A, papel: 'GERENTE', isSuperAdmin: false };

describe('T-181: resumo do turno e fila com liberação e responsável', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  function sql(texto: string) {
    const r = pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
  }
  function toque(card: number, seq: number, resultado: string, liberada: string, realizada: string | null, turno = 'manha') {
    sql(`INSERT INTO cadencia_atividades (oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo, resultado, realizada_em, liberada_em)
         VALUES ('${CARD(card)}', '${EMPRESA_A}', ${seq}, 1, '${turno}', 'telefone', 'ligacao', '${resultado}',
         ${realizada ? `'${realizada}'` : 'NULL'}, '${liberada}')`);
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    sql(`INSERT INTO empresas (id, nome, slug) VALUES ('${EMPRESA_A}', 'A', 'a-f181'), ('${EMPRESA_B}', 'B', 'b-f181');
         INSERT INTO usuarios (id, email, nome) VALUES ('${ANA}', 'ana@f181.com', 'Ana'), ('${BIA}', 'bia@f181.com', 'Bia');
         INSERT INTO leads (id, empresa_id, nome, telefone_e164) VALUES
           ('${LEAD(1)}', '${EMPRESA_A}', 'Lead Um', '+5511999990001'),
           ('${LEAD(2)}', '${EMPRESA_A}', 'Lead Dois', '+5511999990002'),
           ('${LEAD(3)}', '${EMPRESA_A}', 'Lead Três', '+5511999990003'),
           ('${LEAD(4)}', '${EMPRESA_B}', 'Lead Outra Empresa', '+5511999990004');
         INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id, responsavel_id, valor) VALUES
           ('${CARD(1)}', '${EMPRESA_A}', '${LEAD(1)}', 1, '${ANA}', 1000),
           ('${CARD(2)}', '${EMPRESA_A}', '${LEAD(2)}', 1, '${BIA}', 500),
           ('${CARD(3)}', '${EMPRESA_A}', '${LEAD(3)}', 1, '${ANA}', 300),
           ('${CARD(4)}', '${EMPRESA_B}', '${LEAD(4)}', 1, NULL, 9000);`);
    // Card 1 (Ana): um conectou feito hoje no turno, um pendente do turno.
    toque(1, 1, 'conectou', '2026-06-11T08:00:00-03:00', '2026-06-11T08:30:00-03:00');
    toque(1, 2, 'pendente', '2026-06-11T08:45:00-03:00', null);
    // Card 2 (Bia): sem resposta hoje + um atrasado desde ontem (1 dia 4h antes).
    toque(2, 1, 'sem_resposta', '2026-06-11T08:00:00-03:00', '2026-06-11T08:40:00-03:00');
    toque(2, 2, 'pendente', '2026-06-10T09:00:00-03:00', null);
    // Card 3 (Ana): dois atrasados do mesmo card — conta o valor uma vez.
    toque(3, 1, 'pendente', '2026-06-10T14:00:00-03:00', null, 'tarde');
    toque(3, 2, 'pendente', '2026-06-10T14:10:00-03:00', null, 'tarde');
    // Empresa B: não pode aparecer.
    sql(`INSERT INTO cadencia_atividades (oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo, resultado, liberada_em)
         VALUES ('${CARD(4)}', '${EMPRESA_B}', 1, 1, 'manha', 'telefone', 'ligacao', 'pendente', '2026-06-09T09:00:00-03:00')`);
  });

  afterAll(async () => {
    await pool.end();
    pg.parar();
  });

  test('o resumo conta o turno, o dia, os atrasados e a receita sob risco só da empresa @spec:AC-462 @spec:AC-463', async () => {
    const r = await resumoDoTurno(db, gerente, { agora: AGORA });
    expect(r.turno).toBe('manha');
    expect(r.toquesConcluidosTurno).toBe(2);
    expect(r.toquesTotalTurno).toBe(3);
    expect(r.conexoesHoje).toBe(1);
    expect(r.semRespostaHoje).toBe(1);
    expect(r.atrasados).toBe(3);
    expect(r.cardsEmRisco).toBe(2);
    expect(r.receitaSobRisco).toBe(800);
    expect(r.ticketMedio).toBe(400);
    expect(r.maiorAtraso?.leadNome).toBe('Lead Dois');
    expect(r.maiorAtraso?.minutos).toBe(24 * 60);
  });

  test('fora do horário de atendimento o turno mostra 0 de 0 e os atrasados continuam @spec:AC-463', async () => {
    const domingo = new Date('2026-06-14T10:00:00-03:00');
    const r = await resumoDoTurno(db, gerente, { agora: domingo });
    expect(r.turno).toBeNull();
    expect(r.toquesTotalTurno).toBe(0);
    expect(r.toquesConcluidosTurno).toBe(0);
    expect(r.atrasados).toBeGreaterThan(0);
  });

  test('o filtro por responsável restringe o resumo e a fila @spec:AC-468', async () => {
    const resumoBia = await resumoDoTurno(db, gerente, { agora: AGORA, responsavelId: BIA });
    expect(resumoBia.atrasados).toBe(1);
    expect(resumoBia.conexoesHoje).toBe(0);
    expect(resumoBia.semRespostaHoje).toBe(1);

    const fila = await listarFilaDoTurno(db, gerente, { agora: AGORA, incluirAtrasados: true, responsavelId: BIA });
    expect(fila.every((i) => i.responsavel?.id === BIA)).toBe(true);
    expect(fila).toHaveLength(1);
  });

  test('cada item da fila traz liberadaEm e o responsável, e só da empresa da sessão @spec:AC-469', async () => {
    const fila = await listarFilaDoTurno(db, gerente, { agora: AGORA, incluirAtrasados: true });
    expect(fila).toHaveLength(4);
    for (const item of fila) {
      expect(item.liberadaEm).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(item.responsavel?.nome).toBeTruthy();
      expect(item.oportunidade.empresaId).toBe(EMPRESA_A);
    }
    const doBia = fila.find((i) => i.lead.nome === 'Lead Dois');
    expect(doBia?.responsavel).toEqual({ id: BIA, nome: 'Bia' });
    expect(doBia?.liberadaEm).toBe('2026-06-10T12:00:00.000Z');
  });

  test('sem sessão, a fila e o resumo respondem 401 @spec:AC-463 @spec:AC-469', async () => {
    process.env.DATABASE_URL = pg.appUrl;
    const fila = await import('../../src/app/api/atividades/route');
    const resumo = await import('../../src/app/api/atividades/resumo/route');
    const r1 = await fila.GET(new NextRequest('http://localhost/api/atividades?atrasados=1'));
    const r2 = await resumo.GET(new NextRequest('http://localhost/api/atividades/resumo'));
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
  });
});
