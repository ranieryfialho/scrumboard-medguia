// Testes de T-101 (fase2d-kpis, US-061/US-062): repositório de KPIs, contra
// um Postgres 15 efêmero real com as migrations aplicadas — mesmo harness de
// test/repositories/cadencia.test.ts (fixtures via `crm_migrator`,
// repositório exercido pela conexão `crm_app`, RLS ativo).
//
// Cada teste isola os próprios cards por período (`de`/`ate` bem apertados
// ao redor só das datas que o teste criou) em vez de um Postgres por teste —
// mais rápido, e já prova de quebra a prova de AC-226 (o filtro de período é
// quem decide o que entra na conta).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { limitesDoPeriodo, obterKpis, type RespostaKpis } from '../../src/repositories/kpis';
import type { ContextoTenant } from '../../src/lib/auth/tenant';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const ETAPA_ENTRADA = 1;
const ETAPA_REUNIAO_AGENDADA = 8;
const ETAPA_NO_SHOW = 9;
const ETAPA_REUNIAO_REALIZADA = 10;
const ETAPA_PROPOSTA = 11;
const ETAPA_CONTRATO_GANHO = 15;

const EMPRESA_A = 'eeeeeeee-0000-0000-0000-00000000000a';
const EMPRESA_B = 'eeeeeeee-0000-0000-0000-00000000000b';
const LEAD_A = 'eeeeeeee-0000-0000-0000-00000000001a';
const LEAD_B = 'eeeeeeee-0000-0000-0000-00000000001b';
const RESP_A1 = 'eeeeeeee-0000-0000-0000-00000000002a';
const RESP_A2 = 'eeeeeeee-0000-0000-0000-00000000002b';
const RESP_B1 = 'eeeeeeee-0000-0000-0000-00000000002c';

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `eeeeeeee-1111-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

function contextoDe(empresaId: string): ContextoTenant {
  return { usuarioId: RESP_A1, empresaId, papel: 'GERENTE', isSuperAdmin: false };
}

describe('T-101: repositório de KPIs sobre o log de eventos', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa Teste KPIs A', 'empresa-teste-kpis-a'),
         ('${EMPRESA_B}', 'Empresa Teste KPIs B', 'empresa-teste-kpis-b');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES
         ('${LEAD_A}', '${EMPRESA_A}', 'Lead Teste KPIs A'),
         ('${LEAD_B}', '${EMPRESA_B}', 'Lead Teste KPIs B');
       INSERT INTO "usuarios" ("id", "email", "nome") VALUES
         ('${RESP_A1}', 'resp-kpis-a1@teste.local', 'Responsável KPIs A1'),
         ('${RESP_A2}', 'resp-kpis-a2@teste.local', 'Responsável KPIs A2'),
         ('${RESP_B1}', 'resp-kpis-b1@teste.local', 'Responsável KPIs B1');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures para os testes do repositório de KPIs: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  function criarOportunidade(
    empresaId: string,
    leadId: string,
    responsavelId: string,
    criadoEm: string
  ): string {
    const id = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "responsavel_id", "criado_em")
       VALUES ('${id}', '${empresaId}', '${leadId}', ${ETAPA_ENTRADA}, '${responsavelId}', '${criadoEm}')`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar oportunidade fixture: ${resultado.stderr}`);
    }
    return id;
  }

  interface DadosEvento {
    tipo: string;
    etapaDestinoId?: number;
    payload?: Record<string, unknown>;
  }

  function inserirEvento(empresaId: string, oportunidadeId: string, dados: DadosEvento): void {
    const etapaDestino = dados.etapaDestinoId ?? null;
    const payload = dados.payload ? `'${JSON.stringify(dados.payload)}'::jsonb` : 'NULL';
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidade_eventos" ("empresa_id", "oportunidade_id", "tipo", "etapa_destino_id", "ator_tipo", "payload")
       VALUES ('${empresaId}', '${oportunidadeId}', '${dados.tipo}', ${etapaDestino === null ? 'NULL' : etapaDestino}, 'sistema', ${payload})`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao inserir evento fixture: ${resultado.stderr}`);
    }
  }

  function conectar(empresaId: string, oportunidadeId: string): void {
    inserirEvento(empresaId, oportunidadeId, { tipo: 'conexao_whatsapp' });
  }

  function chegouEtapa(empresaId: string, oportunidadeId: string, etapaDestinoId: number): void {
    inserirEvento(empresaId, oportunidadeId, { tipo: 'transicao_etapa', etapaDestinoId });
  }

  describe('AC-221: taxa de conexão (reach rate)', () => {
    const DE = '2026-02-01';
    const ATE = '2026-02-28';
    const CRIADO_EM = '2026-02-10T12:00:00-03:00';

    test('10 cards criados no período, 4 conectados (uma conexão dupla não conta duas vezes) -> conexão 40% @spec:AC-221', async () => {
      const cards = Array.from({ length: 10 }, () => criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, CRIADO_EM));

      // Dois via "Conectou" (atividade_concluida) e dois via WhatsApp — um
      // deles com os dois tipos de evento, para provar que conta uma vez só.
      inserirEvento(EMPRESA_A, cards[0], { tipo: 'atividade_concluida', payload: { resultado: 'conectou' } });
      inserirEvento(EMPRESA_A, cards[1], { tipo: 'atividade_concluida', payload: { resultado: 'conectou' } });
      conectar(EMPRESA_A, cards[2]);
      conectar(EMPRESA_A, cards[3]);
      inserirEvento(EMPRESA_A, cards[3], { tipo: 'atividade_concluida', payload: { resultado: 'conectou' } });

      const resposta = await obterKpis(db, contextoDe(EMPRESA_A), {
        de: DE,
        ate: ATE,
        responsavelId: RESP_A1,
        agora: new Date(CRIADO_EM),
      });

      expect(resposta.conexao).toEqual({ valor: 0.4, numerador: 4, denominador: 10 });
    });
  });

  describe('AC-222: cumprimento da régua de 18 toques', () => {
    const DE = '2026-03-01';
    const ATE = '2026-03-31';
    const CRIADO_EM = '2026-03-10T12:00:00-03:00';

    test('5 cards iniciaram a cadência no período, 2 esgotaram -> cumprimento 40% @spec:AC-222', async () => {
      const cards = Array.from({ length: 5 }, () => criarOportunidade(EMPRESA_A, LEAD_A, RESP_A2, CRIADO_EM));
      for (const card of cards) {
        inserirEvento(EMPRESA_A, card, { tipo: 'cadencia_iniciada' });
      }
      inserirEvento(EMPRESA_A, cards[0], { tipo: 'cadencia_esgotada', payload: { ofertaRevisitaDisponivel: true } });
      inserirEvento(EMPRESA_A, cards[1], { tipo: 'cadencia_esgotada', payload: { ofertaRevisitaDisponivel: true } });

      const resposta = await obterKpis(db, contextoDe(EMPRESA_A), {
        de: DE,
        ate: ATE,
        responsavelId: RESP_A2,
        agora: new Date(CRIADO_EM),
      });

      expect(resposta.cumprimentoCadencia).toEqual({ valor: 0.4, numerador: 2, denominador: 5 });
    });

    test('card criado fora do período não entra no denominador, mesmo com cadencia_iniciada @spec:AC-222', async () => {
      const dentro = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A2, CRIADO_EM);
      const fora = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A2, '2026-04-01T12:00:00-03:00');
      inserirEvento(EMPRESA_A, dentro, { tipo: 'cadencia_iniciada' });
      inserirEvento(EMPRESA_A, fora, { tipo: 'cadencia_iniciada' });

      const resposta = await obterKpis(db, contextoDe(EMPRESA_A), {
        de: DE,
        ate: ATE,
        responsavelId: RESP_A2,
        agora: new Date(CRIADO_EM),
      });

      // Soma ao fixture do teste anterior (mesmo responsável/período): só o
      // card "dentro" deste teste deveria ter entrado, então o denominador
      // sobe exatamente 1 em relação ao teste de cima (de 5 para 6).
      expect(resposta.cumprimentoCadencia.denominador).toBe(6);
    });
  });

  describe('AC-223: agendamento, no-show, proposta e conversão', () => {
    const DE = '2026-04-01';
    const ATE = '2026-04-30';
    const CRIADO_EM = '2026-04-10T12:00:00-03:00';

    test('cada taxa divide pelo denominador certo do funil @spec:AC-223', async () => {
      const cards = Array.from({ length: 7 }, () => criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, CRIADO_EM));
      const [card1, card2, card3, card4, card5, card6] = cards;
      // card7 fica de fora de tudo (nem conectado) — prova que não contamina.

      // Conectados: card1-6 (6 cards).
      for (const card of [card1, card2, card3, card4, card5, card6]) {
        conectar(EMPRESA_A, card);
      }

      // Chegaram a "Reunião agendada" (etapa 8): card1-4 (4 cards).
      for (const card of [card1, card2, card3, card4]) {
        chegouEtapa(EMPRESA_A, card, ETAPA_REUNIAO_AGENDADA);
      }

      // Chegaram a "No-show" (etapa 9), dentre quem chegou a agendada: card1.
      chegouEtapa(EMPRESA_A, card1, ETAPA_NO_SHOW);

      // Chegaram a "Reunião realizada" (etapa 10): card2-5 (4 cards).
      for (const card of [card2, card3, card4, card5]) {
        chegouEtapa(EMPRESA_A, card, ETAPA_REUNIAO_REALIZADA);
      }

      // Chegaram a "Proposta" (etapa 11), dentre quem chegou a realizada: card2-4 (3 cards).
      for (const card of [card2, card3, card4]) {
        chegouEtapa(EMPRESA_A, card, ETAPA_PROPOSTA);
      }

      // Chegou a "Contrato (Ganho)" (etapa 15), dentre quem chegou a proposta: card2.
      chegouEtapa(EMPRESA_A, card2, ETAPA_CONTRATO_GANHO);

      const resposta = await obterKpis(db, contextoDe(EMPRESA_A), {
        de: DE,
        ate: ATE,
        responsavelId: RESP_A1,
        agora: new Date(CRIADO_EM),
      });

      expect(resposta.agendamento).toEqual({ valor: 4 / 6, numerador: 4, denominador: 6 });
      expect(resposta.noShow).toEqual({ valor: 1 / 4, numerador: 1, denominador: 4 });
      expect(resposta.proposta).toEqual({ valor: 3 / 4, numerador: 3, denominador: 4 });
      expect(resposta.conversao).toEqual({ valor: 1 / 3, numerador: 1, denominador: 3 });
    });
  });

  describe('AC-224: divisão por zero não vira número falso', () => {
    const DE = '2026-05-01';
    const ATE = '2026-05-31';
    const CRIADO_EM = '2026-05-10T12:00:00-03:00';

    test('sem nenhuma "Reunião agendada" no período: no-show vem null, mas os demais indicadores calculam normal @spec:AC-224', async () => {
      const cards = Array.from({ length: 5 }, () => criarOportunidade(EMPRESA_A, LEAD_A, RESP_A2, CRIADO_EM));
      const [card1, card2, card3] = cards;
      // 3 de 5 conectados — nenhum chega a "Reunião agendada" (etapa 8).
      conectar(EMPRESA_A, card1);
      conectar(EMPRESA_A, card2);
      conectar(EMPRESA_A, card3);

      const resposta = await obterKpis(db, contextoDe(EMPRESA_A), {
        de: DE,
        ate: ATE,
        responsavelId: RESP_A2,
        agora: new Date(CRIADO_EM),
      });

      // Denominador zero -> sem valor, nunca 0% nem erro.
      expect(resposta.noShow).toEqual({ valor: null, numerador: 0, denominador: 0 });
      expect(resposta.proposta).toEqual({ valor: null, numerador: 0, denominador: 0 });
      expect(resposta.conversao).toEqual({ valor: null, numerador: 0, denominador: 0 });
      expect(resposta.cumprimentoCadencia).toEqual({ valor: null, numerador: 0, denominador: 0 });

      // Indicadores com denominador > 0 continuam calculando normalmente.
      expect(resposta.conexao).toEqual({ valor: 0.6, numerador: 3, denominador: 5 });
      expect(resposta.agendamento).toEqual({ valor: 0, numerador: 0, denominador: 3 });
    });
  });

  describe('AC-225: cada indicador traz numerador e denominador', () => {
    const DE = '2026-06-01';
    const ATE = '2026-06-30';
    const CRIADO_EM = '2026-06-10T12:00:00-03:00';

    test('toda consulta bem-sucedida devolve os 7 indicadores, cada um com valor/numerador/denominador @spec:AC-225', async () => {
      const card = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, CRIADO_EM);
      conectar(EMPRESA_A, card);

      const resposta = await obterKpis(db, contextoDe(EMPRESA_A), {
        de: DE,
        ate: ATE,
        responsavelId: RESP_A1,
        agora: new Date(CRIADO_EM),
      });

      const chaves: (keyof RespostaKpis)[] = [
        'conexao',
        'cumprimentoCadencia',
        'agendamento',
        'noShow',
        'proposta',
        'ativacaoTrial',
        'conversao',
      ];
      expect(Object.keys(resposta).sort()).toEqual([...chaves].sort());
      for (const chave of chaves) {
        const indicador = resposta[chave];
        expect(indicador).toHaveProperty('valor');
        expect(indicador).toHaveProperty('numerador');
        expect(indicador).toHaveProperty('denominador');
        expect(typeof indicador.numerador).toBe('number');
        expect(typeof indicador.denominador).toBe('number');
      }
    });
  });

  describe('AC-226: filtro de período', () => {
    test('só entram na conta os cards criados dentro de [de, ate], ate inclusivo @spec:AC-226', async () => {
      const antes = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, '2026-06-30T23:59:00-03:00'); // último instante de 30/06 local, fora
      const inicio = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, '2026-07-01T00:00:00-03:00'); // início do dia 01/07 local
      const meio = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, '2026-07-15T12:00:00-03:00');
      const fimInclusivo = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, '2026-07-31T23:59:00-03:00'); // último instante do dia 31/07 local
      const depois = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, '2026-08-01T00:00:00-03:00'); // já é 01/08 local, fora
      void antes;
      void depois;

      const resposta = await obterKpis(db, contextoDe(EMPRESA_A), {
        de: '2026-07-01',
        ate: '2026-07-31',
        responsavelId: RESP_A1,
        agora: new Date('2026-07-15T12:00:00-03:00'),
      });

      expect(resposta.conexao.denominador).toBe(3);
      void inicio;
      void meio;
      void fimInclusivo;
    });

    test('sem de/ate, o padrão é o mês corrente (em America/Sao_Paulo) @spec:AC-226', async () => {
      criarOportunidade(EMPRESA_B, LEAD_B, RESP_B1, '2026-08-31T23:00:00-03:00'); // agosto, fora
      const dentro1 = criarOportunidade(EMPRESA_B, LEAD_B, RESP_B1, '2026-09-01T00:00:00-03:00'); // início de setembro
      const dentro2 = criarOportunidade(EMPRESA_B, LEAD_B, RESP_B1, '2026-09-30T23:30:00-03:00'); // fim de setembro
      criarOportunidade(EMPRESA_B, LEAD_B, RESP_B1, '2026-10-01T00:00:00-03:00'); // outubro, fora
      void dentro1;
      void dentro2;

      const resposta = await obterKpis(db, contextoDe(EMPRESA_B), {
        responsavelId: RESP_B1,
        agora: new Date('2026-09-15T12:00:00-03:00'),
      });

      expect(resposta.conexao.denominador).toBe(2);
    });
  });

  describe('AC-227: filtro por responsável', () => {
    const DE = '2026-11-01';
    const ATE = '2026-11-30';
    const CRIADO_EM = '2026-11-10T12:00:00-03:00';

    test('com responsavelId, só os cards desse responsável entram na conta @spec:AC-227', async () => {
      Array.from({ length: 3 }, () => criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, CRIADO_EM));
      Array.from({ length: 2 }, () => criarOportunidade(EMPRESA_A, LEAD_A, RESP_A2, CRIADO_EM));

      const respostaA1 = await obterKpis(db, contextoDe(EMPRESA_A), {
        de: DE,
        ate: ATE,
        responsavelId: RESP_A1,
        agora: new Date(CRIADO_EM),
      });
      const respostaA2 = await obterKpis(db, contextoDe(EMPRESA_A), {
        de: DE,
        ate: ATE,
        responsavelId: RESP_A2,
        agora: new Date(CRIADO_EM),
      });
      const respostaSemFiltro = await obterKpis(db, contextoDe(EMPRESA_A), {
        de: DE,
        ate: ATE,
        agora: new Date(CRIADO_EM),
      });

      expect(respostaA1.conexao.denominador).toBe(3);
      expect(respostaA2.conexao.denominador).toBe(2);
      expect(respostaSemFiltro.conexao.denominador).toBe(5);
    });
  });

  describe('AC-228: isolamento entre empresas', () => {
    const DE = '2026-12-01';
    const ATE = '2026-12-31';
    const CRIADO_EM = '2026-12-10T12:00:00-03:00';

    test('cards da empresa B nunca entram na conta de quem consulta pela empresa A, e vice-versa @spec:AC-228', async () => {
      Array.from({ length: 4 }, () => criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, CRIADO_EM));
      Array.from({ length: 7 }, () => criarOportunidade(EMPRESA_B, LEAD_B, RESP_B1, CRIADO_EM));

      const respostaA = await obterKpis(db, contextoDe(EMPRESA_A), { de: DE, ate: ATE, agora: new Date(CRIADO_EM) });
      const respostaB = await obterKpis(db, contextoDe(EMPRESA_B), { de: DE, ate: ATE, agora: new Date(CRIADO_EM) });

      expect(respostaA.conexao.denominador).toBe(4);
      expect(respostaB.conexao.denominador).toBe(7);
    });
  });

  describe('limitesDoPeriodo (função pura)', () => {
    test('de/ate explícitos geram [00:00 do dia "de", 00:00 do dia seguinte a "ate"] em America/Sao_Paulo', () => {
      const { inicio, fimExclusivo } = limitesDoPeriodo(new Date('2026-01-01T00:00:00-03:00'), '2026-02-01', '2026-02-28');
      expect(inicio.toISOString()).toBe('2026-02-01T03:00:00.000Z');
      expect(fimExclusivo.toISOString()).toBe('2026-03-01T03:00:00.000Z');
    });

    test('sem de/ate, usa o mês corrente de "agora" em America/Sao_Paulo', () => {
      const { inicio, fimExclusivo } = limitesDoPeriodo(new Date('2026-09-15T12:00:00-03:00'));
      expect(inicio.toISOString()).toBe('2026-09-01T03:00:00.000Z');
      expect(fimExclusivo.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    });
  });
});
