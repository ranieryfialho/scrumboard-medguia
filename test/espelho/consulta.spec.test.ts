// T-133 (fase3-espelho-sheets, US-094): prova de AC-329, AC-330 e AC-331
// para `src/espelho/consulta.ts`, contra um Postgres 15 efêmero real (mesmo
// harness de T-042/T-128) com duas empresas — só assim dá pra provar que a
// consulta filtra por empresa e lê o estado real da cadência.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { consultarCardsDoEspelho } from '../../src/espelho/consulta';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA_MEDGUIA = 'aaaaaaaa-1111-0000-0000-000000000001';
const EMPRESA_OUTRA = 'aaaaaaaa-1111-0000-0000-000000000002';

const LEAD_GANHO = 'bbbbbbbb-1111-0000-0000-000000000001';
const LEAD_PERDIDO = 'bbbbbbbb-1111-0000-0000-000000000002';
const LEAD_EM_CADENCIA = 'bbbbbbbb-1111-0000-0000-000000000003';
const LEAD_OUTRA_EMPRESA = 'bbbbbbbb-1111-0000-0000-000000000004';

const OPORTUNIDADE_GANHO = 'cccccccc-1111-0000-0000-000000000001';
const OPORTUNIDADE_PERDIDO = 'cccccccc-1111-0000-0000-000000000002';
const OPORTUNIDADE_EM_CADENCIA = 'cccccccc-1111-0000-0000-000000000003';
const OPORTUNIDADE_OUTRA_EMPRESA = 'cccccccc-1111-0000-0000-000000000004';

const RESPONSAVEL = 'dddddddd-1111-0000-0000-000000000001';

const ETAPA_GANHO = 15; // "Contrato (Ganho)" (drizzle/0005_seeds.sql)
const ETAPA_PERDIDO = 14; // "Perdido"
const ETAPA_SEM_EXIGENCIAS = 1; // "Entrada de leads"

describe('T-133: consulta dos cards do espelho', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_MEDGUIA}', 'Medguia', 'medguia'),
         ('${EMPRESA_OUTRA}', 'Outra empresa', 'outra-empresa-sem-sheets');

       INSERT INTO "usuarios" ("id", "email", "nome") VALUES
         ('${RESPONSAVEL}', 'responsavel@teste.com', 'Ana Atendente');

       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164", "email") VALUES
         ('${LEAD_GANHO}', '${EMPRESA_MEDGUIA}', 'Carlos Lead', '+5511999990001', 'carlos@teste.com'),
         ('${LEAD_PERDIDO}', '${EMPRESA_MEDGUIA}', 'Joana Lead', '+5511999990002', 'joana@teste.com'),
         ('${LEAD_EM_CADENCIA}', '${EMPRESA_MEDGUIA}', 'Marcos Lead', '+5511999990003', 'marcos@teste.com'),
         ('${LEAD_OUTRA_EMPRESA}', '${EMPRESA_OUTRA}', 'Lead de outra empresa', '+5511999990004', 'outra@teste.com');

       INSERT INTO "oportunidades"
         ("id", "empresa_id", "lead_id", "etapa_id", "responsavel_id", "valor")
       VALUES
         ('${OPORTUNIDADE_GANHO}', '${EMPRESA_MEDGUIA}', '${LEAD_GANHO}', ${ETAPA_GANHO}, '${RESPONSAVEL}', 1500.00);

       INSERT INTO "oportunidades"
         ("id", "empresa_id", "lead_id", "etapa_id", "motivo_perda_id")
       VALUES
         ('${OPORTUNIDADE_PERDIDO}', '${EMPRESA_MEDGUIA}', '${LEAD_PERDIDO}', ${ETAPA_PERDIDO},
          (SELECT "id" FROM "motivos_perda" WHERE "nome" = 'Sem interesse'));

       INSERT INTO "oportunidades"
         ("id", "empresa_id", "lead_id", "etapa_id", "responsavel_id",
          "cadencia_dia", "cadencia_turno", "proxima_acao_em")
       VALUES
         ('${OPORTUNIDADE_EM_CADENCIA}', '${EMPRESA_MEDGUIA}', '${LEAD_EM_CADENCIA}', ${ETAPA_SEM_EXIGENCIAS},
          '${RESPONSAVEL}', 3, 'manha', '2026-10-22T14:00:00Z');

       INSERT INTO "oportunidades"
         ("id", "empresa_id", "lead_id", "etapa_id")
       VALUES
         ('${OPORTUNIDADE_OUTRA_EMPRESA}', '${EMPRESA_OUTRA}', '${LEAD_OUTRA_EMPRESA}', ${ETAPA_SEM_EXIGENCIAS});

       INSERT INTO "cadencia_atividades"
         ("oportunidade_id", "empresa_id", "sequencia", "dia", "turno", "canal", "tipo", "resultado")
       VALUES
         ('${OPORTUNIDADE_EM_CADENCIA}', '${EMPRESA_MEDGUIA}', 1, 1, 'manha', 'telefone', 'ligacao', 'sem_resposta'),
         ('${OPORTUNIDADE_EM_CADENCIA}', '${EMPRESA_MEDGUIA}', 2, 1, 'tarde', 'telefone', 'ligacao', 'conectou'),
         ('${OPORTUNIDADE_EM_CADENCIA}', '${EMPRESA_MEDGUIA}', 3, 2, 'manha', 'whatsapp', 'mensagem', 'sem_resposta'),
         ('${OPORTUNIDADE_EM_CADENCIA}', '${EMPRESA_MEDGUIA}', 4, 2, 'tarde', 'whatsapp', 'mensagem', 'conectou'),
         ('${OPORTUNIDADE_EM_CADENCIA}', '${EMPRESA_MEDGUIA}', 5, 3, 'manha', 'telefone', 'ligacao', 'sem_resposta'),
         ('${OPORTUNIDADE_EM_CADENCIA}', '${EMPRESA_MEDGUIA}', 6, 3, 'tarde', 'telefone', 'ligacao', 'pendente'),
         ('${OPORTUNIDADE_EM_CADENCIA}', '${EMPRESA_MEDGUIA}', 7, 3, 'manha', 'whatsapp', 'breakup', 'pendente');`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao preparar fixtures: ${resultado.stderr}`);
    }

    // Consulta roda fora de um ContextoTenant de requisição (é um job do
    // worker, não uma ação de usuário logado) — mesmo papel usado pelo
    // worker para ler/gravar entre tenants (test/worker/ciclo.spec.test.ts).
    pool = new Pool({ connectionString: pg.migratorUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  test('cada card da empresa do Sheets aparece no resultado (@spec:AC-329)', async () => {
    const cards = await consultarCardsDoEspelho(db);
    const nomes = cards.map((card) => card.nome).sort();

    expect(nomes).toEqual(['Carlos Lead', 'Joana Lead', 'Marcos Lead']);
  });

  test('a linha traz etapa, responsável, valor, motivo de perda e as duas datas (@spec:AC-329)', async () => {
    const cards = await consultarCardsDoEspelho(db);

    const cardGanho = cards.find((card) => card.nome === 'Carlos Lead');
    expect(cardGanho).toMatchObject({
      telefone: '+5511999990001',
      email: 'carlos@teste.com',
      etapa: 'Contrato (Ganho)',
      responsavel: 'Ana Atendente',
      valor: 1500,
      motivoPerda: null,
    });
    expect(cardGanho?.criadoEm).toBeInstanceOf(Date);
    expect(cardGanho?.atualizadoEm).toBeInstanceOf(Date);

    const cardPerdido = cards.find((card) => card.nome === 'Joana Lead');
    expect(cardPerdido).toMatchObject({
      etapa: 'Perdido',
      responsavel: null,
      valor: null,
      motivoPerda: 'Sem interesse',
    });
  });

  test('card em cadência traz dia, turno, tentativas (atividades não pendentes) e próxima ação (@spec:AC-330)', async () => {
    const cards = await consultarCardsDoEspelho(db);
    const cardEmCadencia = cards.find((card) => card.nome === 'Marcos Lead');

    expect(cardEmCadencia?.cadencia).toEqual({
      dia: 3,
      turno: 'manha',
      tentativas: 5,
      proximaAcaoEm: new Date('2026-10-22T14:00:00Z'),
    });
  });

  test('card sem cadência não tem bloco de cadência (@spec:AC-330)', async () => {
    const cards = await consultarCardsDoEspelho(db);
    const cardSemCadencia = cards.find((card) => card.nome === 'Carlos Lead');

    expect(cardSemCadencia?.cadencia).toBeNull();
  });

  test('nenhum card da outra empresa entra no resultado (@spec:AC-331)', async () => {
    const cards = await consultarCardsDoEspelho(db);

    expect(cards.some((card) => card.nome === 'Lead de outra empresa')).toBe(false);
    expect(cards).toHaveLength(3);
  });
});
