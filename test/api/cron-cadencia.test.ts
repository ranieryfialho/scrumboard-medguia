// Testes de T-093 (fase2b-cadencia, US-055): rota interna
// `POST /api/cron/cadencia`, contra um Postgres 15 efêmero real (mesmo
// molde de test/api/atividades-concluir.test.ts e
// test/repositories/cadencia.test.ts). A regra de negócio de "quem avança"
// (AC-199), "fim de semana/feriado não vira o dia" (AC-200) e "esgotar os
// 18 toques" (AC-201) já está provada em test/db/cadencia-funcoes.test.ts
// (função SQL) e test/repositories/cadencia.test.ts (repositório) — aqui
// ela só é exercitada de novo através da rota, de ponta a ponta, junto do
// que é exclusivo desta camada: o segredo (AC-202), a auditoria em
// `cron_execucoes` (AC-202) e o fato de varrer todos os tenants numa única
// chamada HTTP (AC-203).
//
// Sem sessão (é uma rota interna, chamada pelo agendador da VPS, ASM-058):
// os fixtures de cadência entram direto pelo repositório (`iniciarCadencia`,
// `concluirAtividade`, T-090), como test/repositories/cadencia.test.ts já
// faz. `vi.setSystemTime` fakeia só `Date` (ASM-062) — a rota lê o relógio
// real (`new Date()`), repositório e função SQL recebem por parâmetro.
//
// Cada teste cria sua própria empresa (`criarEmpresa`): `virarDiaDeTodasAsEmpresas`
// varre TODO tenant ativo a cada chamada, e todos os testes compartilham um
// único Postgres efêmero (um `beforeAll` por arquivo) — um card "pronto para
// avançar" esquecido por um teste anterior (ex.: AC-200, onde fim de
// semana/feriado nunca o varre) contaminaria a contagem de `itensProcessados`
// de qualquer teste posterior que rode num dia útil, se os testes
// compartilhassem tenant.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { concluirAtividade, iniciarCadencia } from '../../src/repositories/cadencia';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const ETAPA_1_DIA = 2;
const ETAPA_2_DIA = 3;
const ETAPA_PERDIDO = 14;
const ETAPA_ENTRADA = 1;

const CRON_SEGREDO_TESTE = 'segredo-cron-teste-123';

// Datas fixas (ASM-062). 2026-06-11 é quinta-feira — dia útil comum, fora
// da lista de feriados de T-088 (mesma data usada pelos demais testes desta
// feature). 2026-06-13 é sábado; 2026-01-01 é feriado nacional
// (Confraternização Universal).
const TARDE_UTIL = new Date('2026-06-11T14:00:00-03:00');
const VIRADA_UTIL = new Date('2026-06-12T00:05:00-03:00');
const SABADO = new Date('2026-06-13T10:00:00-03:00');
const FERIADO_NACIONAL = new Date('2026-01-01T10:00:00-03:00');

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `eeeeeeee-1111-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

function contextoDe(empresaId: string, usuarioId: string): ContextoTenant {
  return { usuarioId, empresaId, papel: 'ATENDENTE', isSuperAdmin: false };
}

function postCron(authorization: string | null) {
  return new NextRequest('http://localhost/api/cron/cadencia', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  });
}

describe('T-093: rota POST /api/cron/cadencia', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let routeModule: typeof import('../../src/app/api/cron/cadencia/route');

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);

    process.env.DATABASE_URL = pg.appUrl;
    process.env.CRON_SEGREDO = CRON_SEGREDO_TESTE;
    routeModule = await import('../../src/app/api/cron/cadencia/route');
  }, 120_000);

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  /**
   * Empresa + lead + usuário dedicados. `virarDiaDeTodasAsEmpresas` varre
   * TODO tenant ativo a cada chamada — um tenant isolado por teste evita que
   * sobras de um teste anterior contaminem a contagem de `itensProcessados`
   * de outro (ver nota de topo do arquivo).
   */
  function criarEmpresa(): { empresaId: string; leadId: string; usuarioId: string } {
    const empresaId = proximoUuid();
    const leadId = proximoUuid();
    const usuarioId = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${empresaId}', 'Empresa ${empresaId}', 'empresa-${empresaId}');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${leadId}', '${empresaId}', 'Lead ${leadId}');
       INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${usuarioId}', 'usuario-${usuarioId}@teste.local', 'Usuário ${usuarioId}');`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar empresa fixture: ${resultado.stderr}`);
    }
    return { empresaId, leadId, usuarioId };
  }

  /**
   * Desativa a empresa (`empresas.ativo = false`) ao final de um teste que
   * deliberadamente deixa um card "pronto para avançar" sem nunca chamar a
   * rota com sucesso sobre ele (401 sem segredo, ou fim de semana/feriado
   * que nunca o varre) — sem isso, esse card ficaria elegível para sempre e
   * contaminaria o `itensProcessados` de qualquer teste posterior que rode
   * a rota num dia útil, já que `virarDiaDeTodasAsEmpresas` varre toda
   * empresa ativa (AC-203), não só a do teste atual.
   */
  function desativarEmpresa(empresaId: string) {
    const resultado = pg.psqlComo('crm_migrator', `UPDATE empresas SET ativo = false WHERE id = '${empresaId}'`);
    if (resultado.status !== 0) {
      throw new Error(`Falha ao desativar empresa fixture: ${resultado.stderr}`);
    }
  }

  function criarOportunidade(empresaId: string, leadId: string): string {
    const id = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id")
       VALUES ('${id}', '${empresaId}', '${leadId}', ${ETAPA_ENTRADA})`
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

  function estadoOportunidade(id: string) {
    return valorJson<{ etapa_id: number; cadencia_dia: number | null; cadencia_encerrada_em: string | null }>(
      `SELECT row_to_json(t) FROM (
         SELECT etapa_id, cadencia_dia, cadencia_encerrada_em FROM oportunidades WHERE id = '${id}'
       ) t`
    );
  }

  function contarExecucoesCron(): number {
    return Number(valor(`SELECT count(*) FROM cron_execucoes WHERE job = 'cadencia-virada-dia'`));
  }

  function ultimaExecucaoCron() {
    return valorJson<{ status: string; itens_processados: number; concluido_em: string | null }>(
      `SELECT row_to_json(t) FROM (
         SELECT status, itens_processados, concluido_em FROM cron_execucoes
         WHERE job = 'cadencia-virada-dia' ORDER BY iniciado_em DESC LIMIT 1
       ) t`
    );
  }

  function contarEventos(oportunidadeId: string, tipo: string): number {
    return Number(
      valor(`SELECT count(*) FROM oportunidade_eventos WHERE oportunidade_id = '${oportunidadeId}' AND tipo = '${tipo}'`)
    );
  }

  /** Inicia a cadência (dia 1, manhã) de um card já criado, sob o `ContextoTenant` informado. */
  async function iniciar(contexto: ContextoTenant, oportunidadeId: string) {
    await iniciarCadencia(db, contexto, oportunidadeId, {
      version: versionAtual(oportunidadeId),
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
    });
  }

  /** Conclui, em ordem de sequência, todos os toques hoje pendentes do bloco (dia, turno) com `sem_resposta`. */
  async function completarBlocoSemResposta(
    contexto: ContextoTenant,
    oportunidadeId: string,
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
        atorId: contexto.usuarioId,
        atorTipo: 'usuario',
        agora: TARDE_UTIL,
      });
    }
  }

  describe('AC-202: job idempotente, protegido por segredo e auditável', () => {
    test('sem o segredo (ausente ou errado): 401, nada é tocado @spec:AC-202', async () => {
      const { empresaId, leadId, usuarioId } = criarEmpresa();
      const contexto = contextoDe(empresaId, usuarioId);
      const cardId = criarOportunidade(empresaId, leadId);
      await iniciar(contexto, cardId);
      await completarBlocoSemResposta(contexto, cardId, 1, 'manha');
      await completarBlocoSemResposta(contexto, cardId, 1, 'tarde');
      const estadoAntes = estadoOportunidade(cardId);

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(VIRADA_UTIL);

      const semCabecalho = await routeModule.POST(postCron(null));
      expect(semCabecalho.status).toBe(401);

      const comSegredoErrado = await routeModule.POST(postCron('Bearer segredo-errado'));
      expect(comSegredoErrado.status).toBe(401);

      expect(estadoOportunidade(cardId)).toEqual(estadoAntes);
      expect(atividades(cardId)).toHaveLength(6);
      expect(contarExecucoesCron()).toBe(0);

      // o card nunca foi varrido (401 nas duas chamadas) e ficaria "pronto
      // para avançar" para sempre — desativa a empresa para não contaminar
      // o itensProcessados de outro teste deste arquivo.
      desativarEmpresa(empresaId);
    });

    test('com o segredo roda e grava sucesso em cron_execucoes; a segunda chamada do mesmo dia não duplica nem avança de novo @spec:AC-202', async () => {
      const { empresaId, leadId, usuarioId } = criarEmpresa();
      const contexto = contextoDe(empresaId, usuarioId);
      const cardId = criarOportunidade(empresaId, leadId);
      await iniciar(contexto, cardId);
      await completarBlocoSemResposta(contexto, cardId, 1, 'manha');
      await completarBlocoSemResposta(contexto, cardId, 1, 'tarde');

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(VIRADA_UTIL);

      const primeira = await routeModule.POST(postCron(`Bearer ${CRON_SEGREDO_TESTE}`));
      const corpoPrimeira = await primeira.json();

      expect(primeira.status).toBe(200);
      expect(corpoPrimeira).toEqual({ status: 'sucesso', itensProcessados: 1 });
      expect(contarExecucoesCron()).toBe(1);
      const execucao1 = ultimaExecucaoCron();
      expect(execucao1.status).toBe('sucesso');
      expect(execucao1.itens_processados).toBe(1);
      expect(execucao1.concluido_em).not.toBeNull();
      expect(estadoOportunidade(cardId).etapa_id).toBe(ETAPA_2_DIA);
      expect(atividades(cardId)).toHaveLength(9);
      expect(contarEventos(cardId, 'cadencia_dia_avancado')).toBe(1);

      // mesmo dia, segunda chamada: o card já avançou e já tem toques
      // pendentes do novo bloco — nada se repete.
      const segunda = await routeModule.POST(postCron(`Bearer ${CRON_SEGREDO_TESTE}`));
      const corpoSegunda = await segunda.json();

      expect(segunda.status).toBe(200);
      expect(corpoSegunda).toEqual({ status: 'sucesso', itensProcessados: 0 });
      expect(contarExecucoesCron()).toBe(2);
      expect(estadoOportunidade(cardId).etapa_id).toBe(ETAPA_2_DIA);
      expect(atividades(cardId)).toHaveLength(9);
      expect(contarEventos(cardId, 'cadencia_dia_avancado')).toBe(1);
    });
  });

  describe('AC-199: virada de dia avança só quem concluiu o dia inteiro', () => {
    test('card com os dois blocos do dia concluídos avança; card com toque pendente fica atrasado @spec:AC-199', async () => {
      const { empresaId, leadId, usuarioId } = criarEmpresa();
      const contexto = contextoDe(empresaId, usuarioId);

      const avanca = criarOportunidade(empresaId, leadId);
      await iniciar(contexto, avanca);
      await completarBlocoSemResposta(contexto, avanca, 1, 'manha');
      await completarBlocoSemResposta(contexto, avanca, 1, 'tarde');

      const atrasado = criarOportunidade(empresaId, leadId);
      await iniciar(contexto, atrasado);
      const [p1, p2] = atividades(atrasado);
      await concluirAtividade(db, contexto, p1.id, {
        version: versionAtual(atrasado),
        resultado: 'sem_resposta',
        atorId: usuarioId,
        atorTipo: 'usuario',
        agora: TARDE_UTIL,
      });
      await concluirAtividade(db, contexto, p2.id, {
        version: versionAtual(atrasado),
        resultado: 'sem_resposta',
        atorId: usuarioId,
        atorTipo: 'usuario',
        agora: TARDE_UTIL,
      });
      // sequência 3 do card "atrasado" fica pendente de propósito.

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(VIRADA_UTIL);

      const resposta = await routeModule.POST(postCron(`Bearer ${CRON_SEGREDO_TESTE}`));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.itensProcessados).toBe(1);

      expect(estadoOportunidade(avanca).etapa_id).toBe(ETAPA_2_DIA);
      expect(atividades(avanca)).toHaveLength(9);

      expect(estadoOportunidade(atrasado).etapa_id).toBe(ETAPA_1_DIA);
      expect(atividades(atrasado)).toHaveLength(3);
      expect(atividades(atrasado).find((a) => a.sequencia === 3)!.resultado).toBe('pendente');
    });
  });

  describe('AC-200: fim de semana e feriado não viram o dia', () => {
    test.each([
      ['sábado', SABADO],
      ['feriado nacional', FERIADO_NACIONAL],
    ])('%s: 0 itens processados, nenhum card muda @spec:AC-200', async (_descricao, agora) => {
      const { empresaId, leadId, usuarioId } = criarEmpresa();
      const contexto = contextoDe(empresaId, usuarioId);
      const cardId = criarOportunidade(empresaId, leadId);
      await iniciar(contexto, cardId);
      await completarBlocoSemResposta(contexto, cardId, 1, 'manha');
      await completarBlocoSemResposta(contexto, cardId, 1, 'tarde');
      const estadoAntes = estadoOportunidade(cardId);

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(agora);

      const resposta = await routeModule.POST(postCron(`Bearer ${CRON_SEGREDO_TESTE}`));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo).toEqual({ status: 'sucesso', itensProcessados: 0 });
      expect(estadoOportunidade(cardId)).toEqual(estadoAntes);
      expect(atividades(cardId)).toHaveLength(6);

      const execucao = ultimaExecucaoCron();
      expect(execucao.status).toBe('sucesso');
      expect(execucao.itens_processados).toBe(0);

      // o fim de semana/feriado nunca varre este card, que ficaria "pronto
      // para avançar" para sempre — desativa a empresa para não contaminar
      // o itensProcessados de outro teste deste arquivo.
      desativarEmpresa(empresaId);
    });
  });

  describe('AC-201: esgotar os 18 toques manda para Perdido', () => {
    test('depois de duas viradas de dia pelo job, o toque 18 (breakup) concluído sem_resposta encerra a cadência em Perdido @spec:AC-201', async () => {
      const { empresaId, leadId, usuarioId } = criarEmpresa();
      const contexto = contextoDe(empresaId, usuarioId);
      const cardId = criarOportunidade(empresaId, leadId);
      await iniciar(contexto, cardId);

      await completarBlocoSemResposta(contexto, cardId, 1, 'manha');
      await completarBlocoSemResposta(contexto, cardId, 1, 'tarde');

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(VIRADA_UTIL);
      const virada1 = await routeModule.POST(postCron(`Bearer ${CRON_SEGREDO_TESTE}`));
      expect((await virada1.json()).itensProcessados).toBe(1);
      expect(estadoOportunidade(cardId).cadencia_dia).toBe(2);

      vi.useRealTimers();
      await completarBlocoSemResposta(contexto, cardId, 2, 'manha');
      await completarBlocoSemResposta(contexto, cardId, 2, 'tarde');

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(VIRADA_UTIL);
      const virada2 = await routeModule.POST(postCron(`Bearer ${CRON_SEGREDO_TESTE}`));
      expect((await virada2.json()).itensProcessados).toBe(1);
      expect(estadoOportunidade(cardId).cadencia_dia).toBe(3);

      vi.useRealTimers();
      await completarBlocoSemResposta(contexto, cardId, 3, 'manha');

      const [toque16, toque17] = atividades(cardId)
        .filter((a) => a.dia === 3 && a.turno === 'tarde' && a.resultado === 'pendente')
        .sort((a, b) => a.sequencia - b.sequencia);
      await concluirAtividade(db, contexto, toque16.id, {
        version: versionAtual(cardId),
        resultado: 'sem_resposta',
        atorId: usuarioId,
        atorTipo: 'usuario',
        agora: TARDE_UTIL,
      });
      await concluirAtividade(db, contexto, toque17.id, {
        version: versionAtual(cardId),
        resultado: 'sem_resposta',
        atorId: usuarioId,
        atorTipo: 'usuario',
        agora: TARDE_UTIL,
      });

      const toque18 = atividades(cardId).find((a) => a.sequencia === 18)!;
      expect(toque18.resultado).toBe('pendente');

      await concluirAtividade(db, contexto, toque18.id, {
        version: versionAtual(cardId),
        resultado: 'sem_resposta',
        atorId: usuarioId,
        atorTipo: 'usuario',
        agora: TARDE_UTIL,
      });

      const estado = estadoOportunidade(cardId);
      expect(estado.etapa_id).toBe(ETAPA_PERDIDO);
      expect(estado.cadencia_encerrada_em).not.toBeNull();
      expect(contarEventos(cardId, 'cadencia_esgotada')).toBe(1);

      // depois de Perdido, uma nova virada do job não toca mais o card.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(VIRADA_UTIL);
      const viradaFinal = await routeModule.POST(postCron(`Bearer ${CRON_SEGREDO_TESTE}`));
      expect((await viradaFinal.json()).itensProcessados).toBe(0);
    });
  });

  describe('AC-203: cada empresa só vê e vira os próprios cards', () => {
    test('uma única chamada avança os cards prontos das duas empresas, sem misturar toque ou card entre tenants @spec:AC-203', async () => {
      const empresaA = criarEmpresa();
      const empresaB = criarEmpresa();
      const contextoA = contextoDe(empresaA.empresaId, empresaA.usuarioId);
      const contextoB = contextoDe(empresaB.empresaId, empresaB.usuarioId);

      const cardA = criarOportunidade(empresaA.empresaId, empresaA.leadId);
      await iniciar(contextoA, cardA);
      await completarBlocoSemResposta(contextoA, cardA, 1, 'manha');
      await completarBlocoSemResposta(contextoA, cardA, 1, 'tarde');

      const cardB = criarOportunidade(empresaB.empresaId, empresaB.leadId);
      await iniciar(contextoB, cardB);
      await completarBlocoSemResposta(contextoB, cardB, 1, 'manha');
      await completarBlocoSemResposta(contextoB, cardB, 1, 'tarde');

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(VIRADA_UTIL);

      const resposta = await routeModule.POST(postCron(`Bearer ${CRON_SEGREDO_TESTE}`));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.itensProcessados).toBe(2);

      expect(estadoOportunidade(cardA).etapa_id).toBe(ETAPA_2_DIA);
      expect(estadoOportunidade(cardB).etapa_id).toBe(ETAPA_2_DIA);

      expect(atividades(cardA)).toHaveLength(9);
      expect(atividades(cardB)).toHaveLength(9);

      const idsCruzados = Number(
        valor(
          `SELECT count(*) FROM cadencia_atividades
           WHERE oportunidade_id = '${cardA}' AND empresa_id <> '${empresaA.empresaId}'`
        )
      );
      expect(idsCruzados).toBe(0);
    });
  });
});
