// T-066 (fase2c-whatsapp-entrada, US-039/040/041/042): prova, contra um
// Postgres 15 efêmero real (harness de test/db/funcoes.test.ts) com a
// migration 0008 aplicada, o índice único parcial de idempotência em
// `whatsapp_mensagens` (AC-124), a função `registrar_conexao_whatsapp`
// (AC-127, AC-128, AC-129, AC-130, AC-132), a atomicidade entre mensagem e
// conexão quando tudo roda numa única transação (AC-131) e o NOTIFY de
// `mensagem.recebida` disparado pelo trigger de INSERT (AC-133).
//
// Para AC-131 e AC-133, `psqlComo` (docker exec + psql síncrono, um `-c` por
// chamada) não serve: AC-131 precisa de uma sessão só com BEGIN/.../ROLLBACK
// no meio, e AC-133 precisa de uma conexão dedicada em `LISTEN oportunidade`
// recebendo a notificação de outra sessão — o mesmo motivo de
// test/sse/notify-sql.test.ts. Por isso esses dois blocos usam o driver `pg`
// direto contra a porta publicada do container (`pg.appUrl`).
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const ETAPA_ENTRADA = 1;
const ETAPA_1_DIA = 2;
const ETAPA_2_DIA = 3;
const ETAPA_3_DIA = 4;
const ETAPA_QUALIFICANDO = 5;
const ETAPA_QUALIFICADO = 6;

const EMPRESA_ID = 'dddddddd-0000-0000-0000-000000000001';
const LEAD_ID = 'dddddddd-0000-0000-0000-000000000002';

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `dddddddd-0000-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

describe('T-066: migration 0008 — idempotência, conexão e NOTIFY de mensagem', () => {
  let pg: PostgresEfemero;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${EMPRESA_ID}', 'Empresa Teste WhatsApp', 'empresa-teste-whatsapp');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${LEAD_ID}', '${EMPRESA_ID}', 'Lead Teste WhatsApp');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);
    }
  }, 120_000);

  afterAll(() => {
    pg?.parar();
  });

  function criarOportunidade(etapaId: number): string {
    const id = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${id}', '${EMPRESA_ID}', '${LEAD_ID}', ${etapaId})`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar oportunidade fixture: ${resultado.stderr}`);
    }
    return id;
  }

  function criarAtividadePendente(oportunidadeId: string, sequencia: number): string {
    const id = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "cadencia_atividades" ("id", "oportunidade_id", "empresa_id", "sequencia", "dia", "turno", "canal", "tipo")
       VALUES ('${id}', '${oportunidadeId}', '${EMPRESA_ID}', ${sequencia}, 1, 'manha', 'whatsapp', 'mensagem')`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar atividade de cadência fixture: ${resultado.stderr}`);
    }
    return id;
  }

  function estadoOportunidade(id: string): string {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT "etapa_id", "version", "cadencia_encerrada_em" IS NOT NULL FROM "oportunidades" WHERE "id" = '${id}'`
    );
    if (resultado.status !== 0) {
      throw new Error(resultado.stderr);
    }
    return resultado.stdout.trim();
  }

  function contarEventos(oportunidadeId: string, tipo: string): number {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${oportunidadeId}' AND "tipo" = '${tipo}'`
    );
    if (resultado.status !== 0) {
      throw new Error(resultado.stderr);
    }
    return Number(resultado.stdout.trim());
  }

  // `psqlComo` roda `SET app.empresa_id` e a chamada de função na mesma
  // sessão (precisa ser a mesma conexão para a RLS valer) — mas o `psql`
  // imprime a tag de status de cada comando (`SET`, `INSERT 0 1`, ...) junto
  // com as linhas de dado, mesmo com `-t -A`. `valorRetornado` descarta essas
  // tags e devolve só o que a última consulta realmente produziu.
  const TAG_DE_COMANDO = /^(SET|BEGIN|COMMIT|ROLLBACK|INSERT \d+ \d+|UPDATE \d+|DELETE \d+)$/;
  function valorRetornado(stdout: string): string {
    return stdout
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => linha !== '' && !TAG_DE_COMANDO.test(linha))
      .join('\n');
  }

  function conectar(
    leadId: string | null,
    evolutionMessageId: string
  ): { status: number | null; stderr: string; valor: string } {
    const leadSql = leadId ? `'${leadId}'` : 'NULL';
    const resultado = pg.psqlComo(
      'crm_app',
      `SET app.empresa_id = '${EMPRESA_ID}'; SELECT registrar_conexao_whatsapp('${EMPRESA_ID}', ${leadSql}, '${evolutionMessageId}')`
    );
    return { status: resultado.status, stderr: resultado.stderr, valor: valorRetornado(resultado.stdout) };
  }

  describe('AC-124: índice único parcial impede mensagem duplicada', () => {
    test('segunda linha com o mesmo (empresa_id, evolution_message_id) viola o índice único @spec:AC-124', () => {
      const evolutionId = `evo-${proximoUuid()}`;
      const primeira = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}';
         INSERT INTO "whatsapp_mensagens" ("empresa_id", "numero", "mensagem", "direcao", "evolution_message_id")
         VALUES ('${EMPRESA_ID}', '558599999001', 'oi', 'recebida', '${evolutionId}')`
      );
      expect(primeira.status).toBe(0);

      const segunda = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}';
         INSERT INTO "whatsapp_mensagens" ("empresa_id", "numero", "mensagem", "direcao", "evolution_message_id")
         VALUES ('${EMPRESA_ID}', '558599999001', 'oi de novo', 'recebida', '${evolutionId}')`
      );
      expect(segunda.status, 'inserção repetida deveria falhar no índice único').not.toBe(0);
      expect(segunda.stderr).toMatch(/duplicate key value violates unique constraint/);

      const contagem = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "whatsapp_mensagens" WHERE "empresa_id" = '${EMPRESA_ID}' AND "evolution_message_id" = '${evolutionId}'`
      );
      expect(contagem.stdout.trim()).toBe('1');
    });

    test('mensagens sem evolution_message_id nunca colidem entre si @spec:AC-124', () => {
      const resultados = [1, 2].map(() =>
        pg.psqlComo(
          'crm_app',
          `SET app.empresa_id = '${EMPRESA_ID}';
           INSERT INTO "whatsapp_mensagens" ("empresa_id", "numero", "mensagem", "direcao")
           VALUES ('${EMPRESA_ID}', '558599999002', 'sem id', 'recebida')`
        )
      );
      for (const resultado of resultados) {
        expect(resultado.status).toBe(0);
      }
    });

    test('ON CONFLICT DO NOTHING absorve a retentativa sem reinserir a linha @spec:AC-124', () => {
      const evolutionId = `evo-${proximoUuid()}`;
      const insertSql = `
        SET app.empresa_id = '${EMPRESA_ID}';
        INSERT INTO "whatsapp_mensagens" ("empresa_id", "lead_id", "numero", "mensagem", "direcao", "evolution_message_id")
        VALUES ('${EMPRESA_ID}', '${LEAD_ID}', '558599999003', 'oi', 'recebida', '${evolutionId}')
        ON CONFLICT ("empresa_id", "evolution_message_id") WHERE "evolution_message_id" IS NOT NULL DO NOTHING;
      `;

      const primeira = pg.psqlComo('crm_app', insertSql);
      expect(primeira.status).toBe(0);
      expect(primeira.stdout, 'primeira inserção deveria afetar 1 linha').toMatch(/INSERT 0 1/);

      const retentativa = pg.psqlComo('crm_app', insertSql);
      expect(retentativa.status).toBe(0);
      expect(retentativa.stdout, 'retentativa não deveria inserir linha nova').toMatch(/INSERT 0 0/);

      const contagem = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "whatsapp_mensagens" WHERE "empresa_id" = '${EMPRESA_ID}' AND "evolution_message_id" = '${evolutionId}'`
      );
      expect(contagem.stdout.trim()).toBe('1');
    });
  });

  describe('AC-127: mensagem de lead em cadência move o card para Qualificando', () => {
    test.each([
      ['1º dia de contato', ETAPA_1_DIA],
      ['2º dia de contato', ETAPA_2_DIA],
      ['3º dia de contato', ETAPA_3_DIA],
    ])('etapa %s move para Qualificando (5), ator_tipo sistema, version incrementada @spec:AC-127', (_nome, etapaOrigem) => {
      const oportunidadeId = criarOportunidade(etapaOrigem);
      const evolutionId = `evo-${proximoUuid()}`;

      const resultado = conectar(LEAD_ID, evolutionId);
      expect(resultado.status, `registrar_conexao_whatsapp deveria ter sucesso: ${resultado.stderr}`).toBe(0);
      expect(resultado.valor).toBe('t');

      expect(estadoOportunidade(oportunidadeId)).toBe(`${ETAPA_QUALIFICANDO}|2|t`);

      const transicao = pg.psqlComo(
        'crm_migrator',
        `SELECT "ator_tipo"::text, "ator_id" IS NULL FROM "oportunidade_eventos"
         WHERE "oportunidade_id" = '${oportunidadeId}' AND "tipo" = 'transicao_etapa'
           AND "etapa_origem_id" = ${etapaOrigem} AND "etapa_destino_id" = ${ETAPA_QUALIFICANDO}`
      );
      expect(transicao.stdout.trim()).toBe('sistema|t');
    });
  });

  describe('AC-128: a conexão é registrada no log e a cadência é encerrada', () => {
    test('grava o evento conexao_whatsapp append-only com ator_tipo sistema e o evolution_message_id no payload @spec:AC-128', () => {
      const oportunidadeId = criarOportunidade(ETAPA_2_DIA);
      const evolutionId = `evo-${proximoUuid()}`;

      const resultado = conectar(LEAD_ID, evolutionId);
      expect(resultado.status).toBe(0);

      const evento = pg.psqlComo(
        'crm_migrator',
        `SELECT "ator_tipo"::text, "payload"->>'evolutionMessageId' FROM "oportunidade_eventos"
         WHERE "oportunidade_id" = '${oportunidadeId}' AND "tipo" = 'conexao_whatsapp'`
      );
      expect(evento.status).toBe(0);
      expect(evento.stdout.trim()).toBe(`sistema|${evolutionId}`);

      expect(estadoOportunidade(oportunidadeId), 'cadencia_encerrada_em deveria estar preenchida').toBe(
        `${ETAPA_QUALIFICANDO}|2|t`
      );
    });

    test('atividades pendentes viram cancelada e nenhuma vira conectou @spec:AC-128', () => {
      const oportunidadeId = criarOportunidade(ETAPA_3_DIA);
      const pendente1 = criarAtividadePendente(oportunidadeId, 1);
      const pendente2 = criarAtividadePendente(oportunidadeId, 2);
      const evolutionId = `evo-${proximoUuid()}`;

      const resultado = conectar(LEAD_ID, evolutionId);
      expect(resultado.status).toBe(0);

      const atividades = pg.psqlComo(
        'crm_migrator',
        `SELECT "id", "resultado" FROM "cadencia_atividades" WHERE "oportunidade_id" = '${oportunidadeId}' ORDER BY "sequencia"`
      );
      expect(atividades.stdout.trim()).toBe([`${pendente1}|cancelada`, `${pendente2}|cancelada`].join('\n'));

      const conectou = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "cadencia_atividades" WHERE "oportunidade_id" = '${oportunidadeId}' AND "resultado" = 'conectou'`
      );
      expect(conectou.stdout.trim()).toBe('0');
    });
  });

  describe('AC-129: fora da cadência, a mensagem não move card nenhum', () => {
    test.each([
      ['etapa 1 (Entrada de leads)', ETAPA_ENTRADA],
      ['etapa 6 (depois de Qualificando)', ETAPA_QUALIFICADO],
    ])('%s: registrar_conexao_whatsapp não altera nada @spec:AC-129', (_nome, etapaId) => {
      const oportunidadeId = criarOportunidade(etapaId);
      const evolutionId = `evo-${proximoUuid()}`;

      const resultado = conectar(LEAD_ID, evolutionId);
      expect(resultado.status).toBe(0);
      expect(resultado.valor).toBe('f');

      expect(estadoOportunidade(oportunidadeId)).toBe(`${etapaId}|1|f`);
      expect(contarEventos(oportunidadeId, 'conexao_whatsapp')).toBe(0);
    });

    test('lead sem nenhuma oportunidade: não falha e não grava nada @spec:AC-129', () => {
      const leadSemOportunidade = proximoUuid();
      const criarLead = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${leadSemOportunidade}', '${EMPRESA_ID}', 'Lead Sem Oportunidade')`
      );
      expect(criarLead.status).toBe(0);

      const resultado = conectar(leadSemOportunidade, `evo-${proximoUuid()}`);
      expect(resultado.status).toBe(0);
      expect(resultado.valor).toBe('f');
    });

    test('lead_id nulo (número não casou com nenhum lead): não falha e não grava nada @spec:AC-129', () => {
      const resultado = conectar(null, `evo-${proximoUuid()}`);
      expect(resultado.status).toBe(0);
      expect(resultado.valor).toBe('f');
    });
  });

  describe('AC-130: segunda mensagem não repete a conexão', () => {
    test('chamar registrar_conexao_whatsapp de novo depois de já ter conectado não gera novo evento nem nova version @spec:AC-130', () => {
      const oportunidadeId = criarOportunidade(ETAPA_1_DIA);

      const primeira = conectar(LEAD_ID, `evo-${proximoUuid()}`);
      expect(primeira.status).toBe(0);
      expect(primeira.valor).toBe('t');
      expect(estadoOportunidade(oportunidadeId)).toBe(`${ETAPA_QUALIFICANDO}|2|t`);

      const segunda = conectar(LEAD_ID, `evo-${proximoUuid()}`);
      expect(segunda.status).toBe(0);
      expect(segunda.valor, 'segunda chamada não deveria encontrar card em cadência').toBe('f');

      expect(estadoOportunidade(oportunidadeId), 'version não muda de novo').toBe(`${ETAPA_QUALIFICANDO}|2|t`);
      expect(contarEventos(oportunidadeId, 'conexao_whatsapp')).toBe(1);
    });
  });

  describe('AC-132: card com versão conflitante não derruba o webhook', () => {
    test('outro operador já tirou o card de 2–4 entre a leitura e a chegada da mensagem: só relê, sem 409 @spec:AC-132', () => {
      const oportunidadeId = criarOportunidade(ETAPA_1_DIA);

      const moveManual = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}';
         SELECT mover_oportunidade('${oportunidadeId}', 1, ${ETAPA_QUALIFICADO}, NULL, 'usuario', NULL)`
      );
      expect(moveManual.status, `moveManual deveria ter sucesso: ${moveManual.stderr}`).toBe(0);

      const resultado = conectar(LEAD_ID, `evo-${proximoUuid()}`);
      expect(resultado.status, `registrar_conexao_whatsapp não deveria falhar: ${resultado.stderr}`).toBe(0);
      expect(resultado.valor, 'card já saiu de 2–4, só deveria constatar isso, sem erro').toBe('f');

      expect(estadoOportunidade(oportunidadeId)).toBe(`${ETAPA_QUALIFICADO}|2|f`);
      expect(contarEventos(oportunidadeId, 'conexao_whatsapp')).toBe(0);
    });
  });

  describe('AC-131: mensagem e conexão são atômicas', () => {
    test('erro depois de inserir a mensagem e conectar desfaz os dois junto com o rollback @spec:AC-131', async () => {
      const oportunidadeId = criarOportunidade(ETAPA_2_DIA);
      const pendente = criarAtividadePendente(oportunidadeId, 1);
      const evolutionId = `evo-${proximoUuid()}`;

      const sessao = new Client({ connectionString: pg.appUrl });
      await sessao.connect();
      try {
        await sessao.query('BEGIN');
        await sessao.query(`SET app.empresa_id = '${EMPRESA_ID}'`);
        await sessao.query(
          `INSERT INTO "whatsapp_mensagens" ("empresa_id", "lead_id", "numero", "mensagem", "direcao", "evolution_message_id")
           VALUES ($1, $2, '558599999004', 'oi', 'recebida', $3)`,
          [EMPRESA_ID, LEAD_ID, evolutionId]
        );
        await sessao.query('SELECT registrar_conexao_whatsapp($1, $2, $3)', [EMPRESA_ID, LEAD_ID, evolutionId]);
        // erro de banco simulado no meio da transação, depois que mensagem e
        // conexão já rodaram — a Evolution retentaria e deve receber 500
        // (prova de rota, fora deste arquivo); aqui provamos que nada do que
        // já rodou sobrevive a esse erro.
        await expect(sessao.query('SELECT 1/0')).rejects.toThrow();
        await sessao.query('ROLLBACK');
      } finally {
        await sessao.end();
      }

      const mensagens = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "whatsapp_mensagens" WHERE "evolution_message_id" = '${evolutionId}'`
      );
      expect(mensagens.stdout.trim(), 'rollback deveria desfazer a mensagem').toBe('0');

      expect(estadoOportunidade(oportunidadeId), 'rollback deveria desfazer a conexão').toBe(`${ETAPA_2_DIA}|1|f`);
      expect(contarEventos(oportunidadeId, 'conexao_whatsapp')).toBe(0);

      const atividade = pg.psqlComo(
        'crm_migrator',
        `SELECT "resultado" FROM "cadencia_atividades" WHERE "id" = '${pendente}'`
      );
      expect(atividade.stdout.trim(), 'rollback deveria desfazer o cancelamento da atividade').toBe('pendente');
    });
  });

  describe('AC-133: mensagem recebida emite mensagem.recebida só para o tenant', () => {
    let ouvinte: Client;
    let notificacoes: Array<{ channel: string; payload: string }>;

    beforeAll(async () => {
      ouvinte = new Client({ connectionString: pg.appUrl });
      await ouvinte.connect();
      ouvinte.on('notification', (msg) => {
        notificacoes.push({ channel: msg.channel, payload: msg.payload ?? '' });
      });
      await ouvinte.query('LISTEN oportunidade');
    });

    afterAll(async () => {
      await ouvinte?.end();
    });

    beforeEach(() => {
      notificacoes = [];
    });

    async function aguardarNotificacoes(ms = 500): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }

    test('INSERT de mensagem recebida dispara NOTIFY com tipo, empresaId, leadId, mensagemId e ocorridoEm — sem texto nem número @spec:AC-133', async () => {
      const evolutionId = `evo-${proximoUuid()}`;
      const inserir = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}';
         INSERT INTO "whatsapp_mensagens" ("empresa_id", "lead_id", "numero", "mensagem", "direcao", "evolution_message_id")
         VALUES ('${EMPRESA_ID}', '${LEAD_ID}', '558599999005', 'conteúdo sigiloso', 'recebida', '${evolutionId}')
         RETURNING "id"`
      );
      expect(inserir.status).toBe(0);
      const mensagemId = valorRetornado(inserir.stdout);

      await aguardarNotificacoes();

      expect(notificacoes).toHaveLength(1);
      expect(notificacoes[0].channel).toBe('oportunidade');

      const payload = JSON.parse(notificacoes[0].payload) as Record<string, unknown>;
      expect(payload.tipo).toBe('mensagem.recebida');
      expect(payload.empresaId).toBe(EMPRESA_ID);
      expect(payload.leadId).toBe(LEAD_ID);
      expect(payload.mensagemId).toBe(mensagemId);
      expect(payload.ocorridoEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(payload).not.toHaveProperty('mensagem');
      expect(payload).not.toHaveProperty('numero');
      expect(JSON.stringify(payload)).not.toContain('sigiloso');
    });

    test('mensagem enviada por nós (direcao enviada) não dispara NOTIFY @spec:AC-133', async () => {
      const enviar = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}';
         INSERT INTO "whatsapp_mensagens" ("empresa_id", "lead_id", "numero", "mensagem", "direcao")
         VALUES ('${EMPRESA_ID}', '${LEAD_ID}', '558599999006', 'resposta nossa', 'enviada')`
      );
      expect(enviar.status).toBe(0);

      await aguardarNotificacoes();
      expect(notificacoes).toHaveLength(0);
    });
  });
});
