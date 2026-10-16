// Testes de T-094 (fase2b-fila-tarefas, US-060): prova, contra um Postgres 15
// efêmero real, as duas pernas da migration 0012 — a coluna `liberada_em` em
// `cadencia_atividades` (base de AC-212: "atrasado" = toque pendente liberado
// num turno/dia anterior ao vigente) e o trigger que emite
// `pg_notify('oportunidade', ...)` com `tipo: 'cadencia.fila_alterada'`
// sempre que um toque é criado ou muda de resultado (AC-217).
//
// O mesmo harness e os mesmos helpers de test/db/cadencia-funcoes.test.ts
// (T-089) e test/sse/notify-sql.test.ts (T-060): `psqlComo` para fixtures e
// chamadas síncronas via SQL, e uma conexão `pg.Client` dedicada a
// `LISTEN oportunidade` para capturar as notificações (uma sessão psql por
// `-c` não serve para isso — não há como manter `LISTEN` entre um
// BEGIN/COMMIT feito por outra sessão).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const ETAPA_ENTRADA = 1;

const EMPRESA_A = 'cccccccc-0000-0000-0000-00000000010a';
const EMPRESA_B = 'cccccccc-0000-0000-0000-00000000010b';
const LEAD_A = 'cccccccc-0000-0000-0000-00000000011a';
const LEAD_B = 'cccccccc-0000-0000-0000-00000000011b';
const USUARIO_A = 'cccccccc-0000-0000-0000-00000000012a';
const USUARIO_B = 'cccccccc-0000-0000-0000-00000000012b';

// 14h em America/Sao_Paulo libera a conclusão de qualquer toque (mesma
// constante de test/db/cadencia-funcoes.test.ts).
const AGORA_TARDE_OK = '2026-06-10T14:00:00-03:00';

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `cccccccc-2222-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

interface Notificacao {
  channel: string;
  payload: string;
}

describe('T-094: liberada_em e NOTIFY da fila', () => {
  describe('AC-217: trigger emite cadencia.fila_alterada em INSERT/UPDATE', () => {
    let pg: PostgresEfemero;
    let ouvinte: Client;
    let notificacoes: Notificacao[];

    beforeAll(async () => {
      pg = await subirPostgresEfemero();
      pg.aplicarMigrations();

      const setup = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
           ('${EMPRESA_A}', 'Empresa Teste Fila A', 'empresa-teste-fila-a'),
           ('${EMPRESA_B}', 'Empresa Teste Fila B', 'empresa-teste-fila-b');
         INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES
           ('${LEAD_A}', '${EMPRESA_A}', 'Lead Teste Fila A'),
           ('${LEAD_B}', '${EMPRESA_B}', 'Lead Teste Fila B');
         INSERT INTO "usuarios" ("id", "email", "nome") VALUES
           ('${USUARIO_A}', 'sdr-fila-a@teste.local', 'SDR Fila A'),
           ('${USUARIO_B}', 'sdr-fila-b@teste.local', 'SDR Fila B');`
      );
      if (setup.status !== 0) {
        throw new Error(`Falha ao preparar fixtures para os testes de NOTIFY da fila: ${setup.stderr}`);
      }

      ouvinte = new Client({ connectionString: pg.appUrl });
      await ouvinte.connect();
      ouvinte.on('notification', (msg) => {
        notificacoes.push({ channel: msg.channel, payload: msg.payload ?? '' });
      });
      await ouvinte.query('LISTEN oportunidade');
    }, 120_000);

    afterAll(async () => {
      await ouvinte?.end();
      pg?.parar();
    });

    beforeEach(() => {
      notificacoes = [];
    });

    async function aguardarNotificacoes(ms = 500): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }

    function criarOportunidade(empresaId: string, leadId: string): string {
      const id = proximoUuid();
      const resultado = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${id}', '${empresaId}', '${leadId}', ${ETAPA_ENTRADA})`
      );
      if (resultado.status !== 0) {
        throw new Error(`Falha ao criar oportunidade fixture: ${resultado.stderr}`);
      }
      return id;
    }

    function versionAtual(oportunidadeId: string): number {
      return Number(
        pg.psqlComo('crm_migrator', `SELECT version FROM oportunidades WHERE id = '${oportunidadeId}'`).stdout.trim()
      );
    }

    function iniciarCadencia(empresaId: string, oportunidadeId: string, atorId: string) {
      const version = versionAtual(oportunidadeId);
      const resultado = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${empresaId}';
         SELECT iniciar_cadencia('${oportunidadeId}', ${version}, '${atorId}', 'usuario', NULL)`
      );
      if (resultado.status !== 0) {
        throw new Error(`iniciar_cadencia falhou: ${resultado.stderr}`);
      }
    }

    function primeiroToquePendente(oportunidadeId: string): string {
      return pg
        .psqlComo(
          'crm_migrator',
          `SELECT id FROM cadencia_atividades WHERE oportunidade_id = '${oportunidadeId}' AND resultado = 'pendente' ORDER BY sequencia LIMIT 1`
        )
        .stdout.trim();
    }

    test('iniciar a cadência (3 INSERTs do bloco, mesmo payload) emite cadencia.fila_alterada com empresaId/oportunidadeId corretos @spec:AC-217', async () => {
      // iniciar_cadencia também chama mover_oportunidade (0007: emite
      // `oportunidade.movida`) antes de inserir o bloco — por isso o canal
      // carrega os dois tipos aqui. As 3 linhas do bloco (sequências 1-3)
      // geram o mesmo payload (só empresaId/oportunidadeId, sem sequência) e
      // o Postgres deduplica NOTIFYs idênticos consecutivos da mesma
      // transação (doc oficial de `NOTIFY`), então chega exatamente 1
      // `cadencia.fila_alterada` — não 3 — o que já basta para a tela
      // recarregar a fila inteira (T-097).
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A);

      iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A);
      await aguardarNotificacoes();

      const filaAlterada = notificacoes.filter((n) => {
        const payload = JSON.parse(n.payload) as Record<string, unknown>;
        return payload.tipo === 'cadencia.fila_alterada';
      });

      expect(filaAlterada).toHaveLength(1);
      const payload = JSON.parse(filaAlterada[0].payload) as Record<string, unknown>;
      expect(filaAlterada[0].channel).toBe('oportunidade');
      expect(payload.empresaId).toBe(EMPRESA_A);
      expect(payload.oportunidadeId).toBe(oportunidadeId);
    });

    test('concluir um toque (UPDATE de resultado) emite cadencia.fila_alterada @spec:AC-217', async () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A);
      iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A);
      await aguardarNotificacoes();
      notificacoes = [];

      const toqueId = primeiroToquePendente(oportunidadeId);
      const version = versionAtual(oportunidadeId);
      const concluir = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_A}';
         SELECT concluir_atividade_cadencia('${toqueId}', ${version}, 'sem_resposta', '${USUARIO_A}', 'usuario', '${AGORA_TARDE_OK}', NULL)`
      );
      expect(concluir.status, `concluir_atividade_cadencia deveria ter sucesso: ${concluir.stderr}`).toBe(0);

      await aguardarNotificacoes();

      expect(notificacoes).toHaveLength(1);
      const payload = JSON.parse(notificacoes[0].payload) as Record<string, unknown>;
      expect(payload.tipo).toBe('cadencia.fila_alterada');
      expect(payload.empresaId).toBe(EMPRESA_A);
      expect(payload.oportunidadeId).toBe(oportunidadeId);
    });

    test('duas empresas em paralelo: cada notificação carrega só o empresaId do card que mudou, nunca o da outra @spec:AC-217', async () => {
      const oportunidadeA = criarOportunidade(EMPRESA_A, LEAD_A);
      const oportunidadeB = criarOportunidade(EMPRESA_B, LEAD_B);

      iniciarCadencia(EMPRESA_A, oportunidadeA, USUARIO_A);
      await aguardarNotificacoes();
      const notificacoesA = notificacoes.map((n) => JSON.parse(n.payload) as Record<string, unknown>);
      expect(notificacoesA.every((p) => p.empresaId === EMPRESA_A)).toBe(true);
      expect(notificacoesA.some((p) => p.empresaId === EMPRESA_B)).toBe(false);
      notificacoes = [];

      iniciarCadencia(EMPRESA_B, oportunidadeB, USUARIO_B);
      await aguardarNotificacoes();
      const notificacoesB = notificacoes.map((n) => JSON.parse(n.payload) as Record<string, unknown>);
      expect(notificacoesB.every((p) => p.empresaId === EMPRESA_B)).toBe(true);
      expect(notificacoesB.some((p) => p.empresaId === EMPRESA_A)).toBe(false);
    });

    test('rollback depois do INSERT/UPDATE em cadencia_atividades nunca entrega a notificação @spec:AC-217', async () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A);
      iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A);
      await aguardarNotificacoes();
      notificacoes = [];

      const toqueId = primeiroToquePendente(oportunidadeId);
      const sessao = new Client({ connectionString: pg.appUrl });
      await sessao.connect();
      try {
        await sessao.query('BEGIN');
        await sessao.query(`SET app.empresa_id = '${EMPRESA_A}'`);
        await sessao.query(
          `UPDATE cadencia_atividades SET resultado = 'sem_resposta', realizada_em = now(), realizada_por = $1 WHERE id = $2`,
          [USUARIO_A, toqueId]
        );
        await sessao.query('ROLLBACK');
      } finally {
        await sessao.end();
      }

      await aguardarNotificacoes();
      expect(notificacoes, 'rollback não deveria entregar notificação').toHaveLength(0);
    });
  });

  describe('AC-212 (base): liberada_em sustenta "atrasado"', () => {
    let pg: PostgresEfemero;

    beforeAll(async () => {
      pg = await subirPostgresEfemero();
      pg.aplicarMigrations();

      const setup = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${EMPRESA_A}', 'Empresa Teste Fila A', 'empresa-teste-fila-a');
         INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${LEAD_A}', '${EMPRESA_A}', 'Lead Teste Fila A');
         INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${USUARIO_A}', 'sdr-fila-a@teste.local', 'SDR Fila A');`
      );
      if (setup.status !== 0) {
        throw new Error(`Falha ao preparar fixtures para os testes de liberada_em: ${setup.stderr}`);
      }
    }, 120_000);

    afterAll(() => {
      pg?.parar();
    });

    test('toque novo (iniciar_cadencia) nasce com liberada_em próximo de agora, não nulo @spec:AC-212', () => {
      const oportunidadeId = proximoUuid();
      const criar = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${oportunidadeId}', '${EMPRESA_A}', '${LEAD_A}', ${ETAPA_ENTRADA})`
      );
      expect(criar.status).toBe(0);

      const version = Number(
        pg.psqlComo('crm_migrator', `SELECT version FROM oportunidades WHERE id = '${oportunidadeId}'`).stdout.trim()
      );
      const antes = Date.now();
      const iniciar = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_A}';
         SELECT iniciar_cadencia('${oportunidadeId}', ${version}, '${USUARIO_A}', 'usuario', NULL)`
      );
      expect(iniciar.status, `iniciar_cadencia deveria ter sucesso: ${iniciar.stderr}`).toBe(0);
      const depois = Date.now();

      const linhas = JSON.parse(
        pg
          .psqlComo(
            'crm_migrator',
            `SELECT coalesce(json_agg(liberada_em), '[]'::json) FROM cadencia_atividades WHERE oportunidade_id = '${oportunidadeId}'`
          )
          .stdout.trim()
      ) as string[];

      expect(linhas).toHaveLength(3);
      for (const liberadaEm of linhas) {
        expect(liberadaEm).not.toBeNull();
        const instante = new Date(liberadaEm).getTime();
        expect(instante).toBeGreaterThanOrEqual(antes - 1000);
        expect(instante).toBeLessThanOrEqual(depois + 1000);
      }
    });

    test('coluna liberada_em é NOT NULL — INSERT sem valor explícito usa o default now() @spec:AC-212', () => {
      const oportunidadeId = proximoUuid();
      const criar = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${oportunidadeId}', '${EMPRESA_A}', '${LEAD_A}', ${ETAPA_ENTRADA})`
      );
      expect(criar.status).toBe(0);

      const insercaoDireta = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO cadencia_atividades (oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo)
         VALUES ('${oportunidadeId}', '${EMPRESA_A}', 1, 1, 'manha', 'telefone', 'ligacao')`
      );
      expect(insercaoDireta.status, `INSERT sem liberada_em explícito deveria ter sucesso (default): ${insercaoDireta.stderr}`).toBe(
        0
      );

      const liberadaEm = pg
        .psqlComo(
          'crm_migrator',
          `SELECT liberada_em FROM cadencia_atividades WHERE oportunidade_id = '${oportunidadeId}' AND sequencia = 1`
        )
        .stdout.trim();
      expect(liberadaEm).not.toBe('');
    });
  });

  describe('AC-212 (base): backfill de toques que já existiam antes da migration 0012', () => {
    let pg: PostgresEfemero;
    const OPORTUNIDADE_BACKFILL = 'cccccccc-3333-0000-0000-000000000001';

    beforeAll(async () => {
      pg = await subirPostgresEfemero();
      aplicarMigrationsExceto(pg, '0012_cadencia_fila.sql');

      const setup = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${EMPRESA_A}', 'Empresa Teste Backfill', 'empresa-teste-backfill');
         INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${LEAD_A}', '${EMPRESA_A}', 'Lead Teste Backfill');
         INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${OPORTUNIDADE_BACKFILL}', '${EMPRESA_A}', '${LEAD_A}', ${ETAPA_ENTRADA});`
      );
      if (setup.status !== 0) {
        throw new Error(`Falha ao preparar fixtures pré-migration 0012: ${setup.stderr}`);
      }
    }, 120_000);

    afterAll(() => {
      pg?.parar();
    });

    function aplicarMigrationsExceto(alvo: PostgresEfemero, arquivoExcluido: string) {
      const drizzleDir = path.join(process.cwd(), 'drizzle');
      const arquivos = fs
        .readdirSync(drizzleDir)
        .filter((nome) => nome.endsWith('.sql') && nome !== arquivoExcluido)
        .sort();

      for (const arquivo of arquivos) {
        const sql = fs.readFileSync(path.join(drizzleDir, arquivo), 'utf8');
        const resultado = spawnSync(
          'docker',
          ['exec', '-i', alvo.containerName, 'psql', '-U', 'crm_migrator', '-d', alvo.database, '-v', 'ON_ERROR_STOP=1'],
          { encoding: 'utf8', input: sql }
        );
        if (resultado.status !== 0) {
          throw new Error(`Falha ao aplicar migration "${arquivo}" (pré-0012): ${resultado.stderr}`);
        }
      }
    }

    function aplicarMigration0012(alvo: PostgresEfemero) {
      const sql = fs.readFileSync(path.join(process.cwd(), 'drizzle', '0012_cadencia_fila.sql'), 'utf8');
      const resultado = spawnSync(
        'docker',
        ['exec', '-i', alvo.containerName, 'psql', '-U', 'crm_migrator', '-d', alvo.database, '-v', 'ON_ERROR_STOP=1'],
        { encoding: 'utf8', input: sql }
      );
      if (resultado.status !== 0) {
        throw new Error(`Falha ao aplicar a migration 0012: ${resultado.stderr}`);
      }
    }

    test('toque já concluído antes da 0012 recebe liberada_em = realizada_em; pendente sem histórico recebe o horário da migration @spec:AC-212', () => {
      const concluidoId = proximoUuid();
      const pendenteId = proximoUuid();
      const realizadaEm = '2026-05-01T12:00:00-03:00';

      const fixtures = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO cadencia_atividades (id, oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo, resultado, realizada_em)
         VALUES ('${concluidoId}', '${OPORTUNIDADE_BACKFILL}', '${EMPRESA_A}', 1, 1, 'manha', 'telefone', 'ligacao', 'sem_resposta', '${realizadaEm}');
         INSERT INTO cadencia_atividades (id, oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo, resultado)
         VALUES ('${pendenteId}', '${OPORTUNIDADE_BACKFILL}', '${EMPRESA_A}', 2, 1, 'manha', 'telefone', 'mensagem', 'pendente');`
      );
      if (fixtures.status !== 0) {
        throw new Error(`Falha ao criar toques pré-0012: ${fixtures.stderr}`);
      }

      const antesDaMigration = Date.now();
      aplicarMigration0012(pg);
      const depoisDaMigration = Date.now();

      const liberadaEmConcluido = pg
        .psqlComo('crm_migrator', `SELECT liberada_em FROM cadencia_atividades WHERE id = '${concluidoId}'`)
        .stdout.trim();
      expect(new Date(liberadaEmConcluido).getTime()).toBe(new Date(realizadaEm).getTime());

      const liberadaEmPendente = pg
        .psqlComo('crm_migrator', `SELECT liberada_em FROM cadencia_atividades WHERE id = '${pendenteId}'`)
        .stdout.trim();
      const instantePendente = new Date(liberadaEmPendente).getTime();
      expect(instantePendente).toBeGreaterThanOrEqual(antesDaMigration - 1000);
      expect(instantePendente).toBeLessThanOrEqual(depoisDaMigration + 1000);
    });
  });
});
