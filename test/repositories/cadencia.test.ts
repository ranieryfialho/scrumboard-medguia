// Testes de T-090 (fase2b-cadencia): repositório de cadência, contra um
// Postgres 15 efêmero real com as migrations até 0011 aplicadas (T-089).
// Fixtures de empresa/lead/usuário/oportunidade entram via `crm_migrator`
// (bypassa RLS), igual a test/repositories/oportunidades.test.ts e
// test/db/cadencia-funcoes.test.ts; o repositório sob teste é exercido pela
// conexão `crm_app` (RLS ativo), como em produção.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import {
  concluirAtividade,
  iniciarCadencia,
  listarFilaDoTurno,
  virarDiaDeTodasAsEmpresas,
} from '../../src/repositories/cadencia';
import type { ContextoTenant } from '../../src/lib/auth/tenant';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const ETAPA_ENTRADA = 1;
const ETAPA_1_DIA = 2;
const ETAPA_2_DIA = 3;
const ETAPA_QUALIFICANDO = 5;

const EMPRESA_A = 'dddddddd-0000-0000-0000-00000000000a';
const EMPRESA_B = 'dddddddd-0000-0000-0000-00000000000b';
const LEAD_A = 'dddddddd-0000-0000-0000-00000000001a';
const LEAD_B = 'dddddddd-0000-0000-0000-00000000001b';
const RESP_A1 = 'dddddddd-0000-0000-0000-00000000002a';
const RESP_A2 = 'dddddddd-0000-0000-0000-00000000002b';
const RESP_B1 = 'dddddddd-0000-0000-0000-00000000002c';
// Dedicado só ao teste de AC-192: os demais testes deste arquivo rodam
// contra o mesmo Postgres efêmero (um `beforeAll` por arquivo) e deixam
// cards pendentes de RESP_A1 por perto — um responsável exclusivo evita que
// essas sobras contaminem a contagem exata da fila.
const RESP_FILA = 'dddddddd-0000-0000-0000-00000000002d';

// Datas fixas (ASM-062: o relógio é sempre recebido por parâmetro, nunca
// `Date.now()` real). 2026-06-11/12 são quinta/sexta — dias úteis comuns,
// fora da lista de feriados de T-088 (mesmas datas usadas por
// test/db/cadencia-funcoes.test.ts). 2026-06-13 é sábado.
const MANHA_UTIL = new Date('2026-06-11T09:00:00-03:00');
const TARDE_UTIL = new Date('2026-06-11T14:00:00-03:00');
const FORA_DE_TURNO = new Date('2026-06-11T12:30:00-03:00');
const SABADO = new Date('2026-06-13T10:00:00-03:00');
const VIRADA_UTIL = new Date('2026-06-12T00:05:00-03:00');

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `dddddddd-1111-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

function contextoDe(empresaId: string, usuarioId: string): ContextoTenant {
  return { usuarioId, empresaId, papel: 'ATENDENTE', isSuperAdmin: false };
}

describe('T-090: repositório de cadência', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa Teste Repo Cadencia A', 'empresa-teste-repo-cadencia-a'),
         ('${EMPRESA_B}', 'Empresa Teste Repo Cadencia B', 'empresa-teste-repo-cadencia-b');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES
         ('${LEAD_A}', '${EMPRESA_A}', 'Lead Teste A'),
         ('${LEAD_B}', '${EMPRESA_B}', 'Lead Teste B');
       INSERT INTO "usuarios" ("id", "email", "nome") VALUES
         ('${RESP_A1}', 'resp-a1@teste.local', 'Responsável A1'),
         ('${RESP_A2}', 'resp-a2@teste.local', 'Responsável A2'),
         ('${RESP_B1}', 'resp-b1@teste.local', 'Responsável B1'),
         ('${RESP_FILA}', 'resp-fila@teste.local', 'Responsável Fila');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures para os testes do repositório de cadência: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  function criarOportunidade(empresaId: string, leadId: string, responsavelId: string): string {
    const id = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "responsavel_id")
       VALUES ('${id}', '${empresaId}', '${leadId}', ${ETAPA_ENTRADA}, '${responsavelId}')`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar oportunidade fixture: ${resultado.stderr}`);
    }
    return id;
  }

  function valor(sqlTexto: string): string {
    const resultado = pg.psqlComo('crm_migrator', sqlTexto);
    if (resultado.status !== 0) {
      throw new Error(`Falha ao consultar fixture: ${resultado.stderr}`);
    }
    return resultado.stdout.trim();
  }

  function valorJson<T = unknown>(sqlTexto: string): T {
    return JSON.parse(valor(sqlTexto)) as T;
  }

  function versionAtual(oportunidadeId: string): number {
    return Number(valor(`SELECT version FROM oportunidades WHERE id = '${oportunidadeId}'`));
  }

  function estadoOportunidade(id: string) {
    return valorJson<{
      etapa_id: number;
      version: number;
      cadencia_dia: number | null;
      cadencia_turno: string | null;
      cadencia_encerrada_em: string | null;
    }>(
      `SELECT row_to_json(t) FROM (
         SELECT etapa_id, version, cadencia_dia, cadencia_turno, cadencia_encerrada_em
         FROM oportunidades WHERE id = '${id}'
       ) t`
    );
  }

  interface AtividadeLinha {
    id: string;
    sequencia: number;
    dia: number;
    turno: string;
    resultado: string;
  }

  function atividades(oportunidadeId: string): AtividadeLinha[] {
    return valorJson<AtividadeLinha[]>(
      `SELECT coalesce(json_agg(t), '[]'::json) FROM (
         SELECT id, sequencia, dia, turno, resultado
         FROM cadencia_atividades WHERE oportunidade_id = '${oportunidadeId}' ORDER BY sequencia
       ) t`
    );
  }

  function contarEventos(oportunidadeId: string, tipo: string): number {
    return Number(
      valor(`SELECT count(*) FROM oportunidade_eventos WHERE oportunidade_id = '${oportunidadeId}' AND tipo = '${tipo}'`)
    );
  }

  /** Conclui, em ordem de sequência, todos os toques hoje pendentes do bloco (dia, turno) com `sem_resposta`. */
  async function completarBlocoSemResposta(
    contexto: ContextoTenant,
    oportunidadeId: string,
    atorId: string,
    dia: number,
    turno: 'manha' | 'tarde'
  ) {
    const pendentes = atividades(oportunidadeId)
      .filter((a) => a.dia === dia && a.turno === turno && a.resultado === 'pendente')
      .sort((a, b) => a.sequencia - b.sequencia);

    for (const toque of pendentes) {
      await concluirAtividade(db, contexto, toque.id, {
        version: versionAtual(oportunidadeId),
        resultado: 'sem_resposta',
        atorId,
        atorTipo: 'usuario',
        agora: TARDE_UTIL,
      });
    }
  }

  describe('AC-190: iniciar gera só o primeiro bloco', () => {
    test('card vai para 1º dia de contato (dia 1, manhã) com exatamente 3 toques pendentes (1-3) @spec:AC-190', async () => {
      const contexto = contextoDe(EMPRESA_A, RESP_A1);
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1);

      const resultado = await iniciarCadencia(db, contexto, oportunidadeId, {
        version: versionAtual(oportunidadeId),
        atorId: RESP_A1,
        atorTipo: 'usuario',
      });

      expect(resultado.oportunidade.etapaId).toBe(ETAPA_1_DIA);
      expect(resultado.oportunidade.cadenciaDia).toBe(1);
      expect(resultado.oportunidade.cadenciaTurno).toBe('manha');

      expect(resultado.toques).toHaveLength(3);
      expect(resultado.toques.map((t) => t.sequencia)).toEqual([1, 2, 3]);
      expect(resultado.toques.every((t) => t.resultado === 'pendente')).toBe(true);

      // só os 3 do primeiro bloco — nenhum dos outros 15 toques existe ainda.
      expect(atividades(oportunidadeId)).toHaveLength(3);
    });
  });

  describe('AC-192: fila "Minhas tarefas" lista só o turno liberado', () => {
    test('mostra só os toques pendentes do turno vigente, do responsável e do tenant; vazia fora de turno, dia não útil @spec:AC-192', async () => {
      const contextoFila = contextoDe(EMPRESA_A, RESP_FILA);

      // card com o bloco da manhã pendente.
      const cardManha = criarOportunidade(EMPRESA_A, LEAD_A, RESP_FILA);
      await iniciarCadencia(db, contextoFila, cardManha, {
        version: versionAtual(cardManha),
        atorId: RESP_FILA,
        atorTipo: 'usuario',
      });

      // card com a manhã concluída (sem_resposta) — libera o bloco da tarde.
      const cardTarde = criarOportunidade(EMPRESA_A, LEAD_A, RESP_FILA);
      await iniciarCadencia(db, contextoFila, cardTarde, {
        version: versionAtual(cardTarde),
        atorId: RESP_FILA,
        atorTipo: 'usuario',
      });
      await completarBlocoSemResposta(contextoFila, cardTarde, RESP_FILA, 1, 'manha');

      // card de outro responsável no mesmo tenant — não deve aparecer no filtro de RESP_FILA.
      const cardOutroResp = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A2);
      await iniciarCadencia(db, contextoDe(EMPRESA_A, RESP_A2), cardOutroResp, {
        version: versionAtual(cardOutroResp),
        atorId: RESP_A2,
        atorTipo: 'usuario',
      });

      const filaManha = await listarFilaDoTurno(db, contextoFila, { responsavelId: RESP_FILA, agora: MANHA_UTIL });
      expect(filaManha).toHaveLength(3);
      expect(filaManha.every((item) => item.atividade.turno === 'manha')).toBe(true);
      expect(new Set(filaManha.map((item) => item.oportunidade.id))).toEqual(new Set([cardManha]));

      const filaTarde = await listarFilaDoTurno(db, contextoFila, { responsavelId: RESP_FILA, agora: TARDE_UTIL });
      expect(filaTarde).toHaveLength(3);
      expect(filaTarde.every((item) => item.atividade.turno === 'tarde')).toBe(true);
      expect(new Set(filaTarde.map((item) => item.oportunidade.id))).toEqual(new Set([cardTarde]));

      const filaForaDeTurno = await listarFilaDoTurno(db, contextoFila, { responsavelId: RESP_FILA, agora: FORA_DE_TURNO });
      expect(filaForaDeTurno).toEqual([]);

      const filaSabado = await listarFilaDoTurno(db, contextoFila, { responsavelId: RESP_FILA, agora: SABADO });
      expect(filaSabado).toEqual([]);
    });
  });

  describe('AC-193: concluir com sem_resposta registra o fato', () => {
    test('toque fica sem_resposta, com realizada_em e realizada_por preenchidos, e grava atividade_concluida @spec:AC-193', async () => {
      const contexto = contextoDe(EMPRESA_A, RESP_A1);
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1);
      const iniciado = await iniciarCadencia(db, contexto, oportunidadeId, {
        version: versionAtual(oportunidadeId),
        atorId: RESP_A1,
        atorTipo: 'usuario',
      });
      const toque1 = iniciado.toques[0];

      const concluido = await concluirAtividade(db, contexto, toque1.id, {
        version: versionAtual(oportunidadeId),
        resultado: 'sem_resposta',
        atorId: RESP_A1,
        atorTipo: 'usuario',
        agora: MANHA_UTIL,
      });

      expect(concluido.resultado).toBe('sem_resposta');
      expect(concluido.realizadaEm).not.toBeNull();
      expect(concluido.realizadaPor).toBe(RESP_A1);
      expect(contarEventos(oportunidadeId, 'atividade_concluida')).toBe(1);
    });
  });

  describe('AC-195: conectou interrompe a cadência na hora', () => {
    test('cancela as pendentes, encerra a cadência e move para Qualificando, sem gerar novos blocos @spec:AC-195', async () => {
      const contexto = contextoDe(EMPRESA_A, RESP_A1);
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1);
      const iniciado = await iniciarCadencia(db, contexto, oportunidadeId, {
        version: versionAtual(oportunidadeId),
        atorId: RESP_A1,
        atorTipo: 'usuario',
      });
      const [t1, t2, t3] = iniciado.toques;

      await concluirAtividade(db, contexto, t1.id, {
        version: versionAtual(oportunidadeId),
        resultado: 'sem_resposta',
        atorId: RESP_A1,
        atorTipo: 'usuario',
        agora: MANHA_UTIL,
      });

      const conectou = await concluirAtividade(db, contexto, t2.id, {
        version: versionAtual(oportunidadeId),
        resultado: 'conectou',
        atorId: RESP_A1,
        atorTipo: 'usuario',
        agora: MANHA_UTIL,
      });
      expect(conectou.resultado).toBe('conectou');

      const estado = estadoOportunidade(oportunidadeId);
      expect(estado.cadencia_encerrada_em).not.toBeNull();
      expect(estado.etapa_id).toBe(ETAPA_QUALIFICANDO);

      const todas = atividades(oportunidadeId);
      expect(todas).toHaveLength(3); // nenhum bloco novo gerado
      expect(todas.find((a) => a.id === t3.id)!.resultado).toBe('cancelada');
    });
  });

  describe('AC-203: cada empresa só vê e vira os próprios cards', () => {
    test('a fila de cada tenant só traz os próprios toques, e a virada de dia avança cada empresa sem misturar cards @spec:AC-203', async () => {
      const contextoA = contextoDe(EMPRESA_A, RESP_A1);
      const contextoB = contextoDe(EMPRESA_B, RESP_B1);

      const cardA = criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1);
      await iniciarCadencia(db, contextoA, cardA, {
        version: versionAtual(cardA),
        atorId: RESP_A1,
        atorTipo: 'usuario',
      });
      await completarBlocoSemResposta(contextoA, cardA, RESP_A1, 1, 'manha');
      await completarBlocoSemResposta(contextoA, cardA, RESP_A1, 1, 'tarde');

      const cardB = criarOportunidade(EMPRESA_B, LEAD_B, RESP_B1);
      await iniciarCadencia(db, contextoB, cardB, {
        version: versionAtual(cardB),
        atorId: RESP_B1,
        atorTipo: 'usuario',
      });
      await completarBlocoSemResposta(contextoB, cardB, RESP_B1, 1, 'manha');
      await completarBlocoSemResposta(contextoB, cardB, RESP_B1, 1, 'tarde');

      // fila: a consulta de cada tenant nunca devolve toque de outra empresa.
      const filaA = await listarFilaDoTurno(db, contextoA, { agora: MANHA_UTIL });
      expect(filaA.every((item) => item.oportunidade.empresaId === EMPRESA_A)).toBe(true);
      const filaB = await listarFilaDoTurno(db, contextoB, { agora: MANHA_UTIL });
      expect(filaB.every((item) => item.oportunidade.empresaId === EMPRESA_B)).toBe(true);

      const virada = await virarDiaDeTodasAsEmpresas(db, VIRADA_UTIL);
      const resultadoA = virada.find((r) => r.empresaId === EMPRESA_A)!;
      const resultadoB = virada.find((r) => r.empresaId === EMPRESA_B)!;

      expect(resultadoA.oportunidadesAvancadas.map((o) => o.id)).toEqual([cardA]);
      expect(resultadoA.oportunidadesAvancadas.every((o) => o.empresaId === EMPRESA_A)).toBe(true);
      expect(resultadoB.oportunidadesAvancadas.map((o) => o.id)).toEqual([cardB]);
      expect(resultadoB.oportunidadesAvancadas.every((o) => o.empresaId === EMPRESA_B)).toBe(true);

      expect(estadoOportunidade(cardA).etapa_id).toBe(ETAPA_2_DIA);
      expect(estadoOportunidade(cardB).etapa_id).toBe(ETAPA_2_DIA);
    });
  });
});
