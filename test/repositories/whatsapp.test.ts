// Testes de T-068 (fase2c-whatsapp-entrada): repositório do WhatsApp de
// entrada, contra um Postgres 15 efêmero real com a migration 0008 aplicada
// (índice único de idempotência e `registrar_conexao_whatsapp`, provados em
// si em test/whatsapp/conexao-sql.test.ts — aqui prova-se a ligação de ponta
// a ponta a partir do repositório: casamento de telefone, idempotência e
// isolamento entre tenants, tudo via `registrarMensagemRecebida`).
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buscarLeadPorNumero, registrarMensagemRecebida } from '../../src/repositories/whatsapp';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA_A = 'a0000000-0000-0000-0000-000000000001';
const EMPRESA_B = 'a0000000-0000-0000-0000-000000000002';

// Casa (telefone com nono dígito, AC-125) e tem oportunidade em cadência —
// usado pelo teste de isolamento entre tenants (AC-126).
const LEAD_CADENCIA_A = 'a0000000-0000-0000-0000-00000000a001';
const OPORTUNIDADE_CADENCIA_A = 'a0000000-0000-0000-0000-00000000c001';
// Mesmo telefone do lead acima, mas na empresa B.
const LEAD_MESMO_TELEFONE_B = 'a0000000-0000-0000-0000-00000000b001';
const OPORTUNIDADE_CADENCIA_B = 'a0000000-0000-0000-0000-00000000c002';

// Telefone próprio, sem oportunidade — só para a variação do nono dígito (AC-125).
const LEAD_VARIACAO_A = 'a0000000-0000-0000-0000-00000000a002';

// Fora da cadência nos três sentidos (AC-129).
const LEAD_ETAPA_1_A = 'a0000000-0000-0000-0000-00000000a003';
const OPORTUNIDADE_ETAPA_1_A = 'a0000000-0000-0000-0000-00000000c003';
const LEAD_ETAPA_6_A = 'a0000000-0000-0000-0000-00000000a004';
const OPORTUNIDADE_ETAPA_6_A = 'a0000000-0000-0000-0000-00000000c004';
const LEAD_SEM_OPORTUNIDADE_A = 'a0000000-0000-0000-0000-00000000a005';

// Dedicado à prova de idempotência (AC-124), isolado dos demais para não
// depender da ordem de execução dos outros testes.
const LEAD_IDEMPOTENCIA_A = 'a0000000-0000-0000-0000-00000000a006';
const OPORTUNIDADE_IDEMPOTENCIA_A = 'a0000000-0000-0000-0000-00000000c005';

describe('T-068: repositório do WhatsApp de entrada', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A WhatsApp', 'empresa-a-whatsapp'),
         ('${EMPRESA_B}', 'Empresa B WhatsApp', 'empresa-b-whatsapp');

       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES
         ('${LEAD_CADENCIA_A}', '${EMPRESA_A}', 'Lead Cadência A', '+5585999985587'),
         ('${LEAD_MESMO_TELEFONE_B}', '${EMPRESA_B}', 'Lead Mesmo Telefone B', '+5585999985587'),
         ('${LEAD_VARIACAO_A}', '${EMPRESA_A}', 'Lead Variação A', '+5591988884444'),
         ('${LEAD_ETAPA_1_A}', '${EMPRESA_A}', 'Lead Etapa 1 A', '+5585977776666'),
         ('${LEAD_ETAPA_6_A}', '${EMPRESA_A}', 'Lead Etapa 6 A', '+5585977775555'),
         ('${LEAD_SEM_OPORTUNIDADE_A}', '${EMPRESA_A}', 'Lead Sem Oportunidade A', '+5585977774444'),
         ('${LEAD_IDEMPOTENCIA_A}', '${EMPRESA_A}', 'Lead Idempotência A', '+5585966665555');

       INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES
         ('${OPORTUNIDADE_CADENCIA_A}', '${EMPRESA_A}', '${LEAD_CADENCIA_A}', 2),
         ('${OPORTUNIDADE_CADENCIA_B}', '${EMPRESA_B}', '${LEAD_MESMO_TELEFONE_B}', 2),
         ('${OPORTUNIDADE_ETAPA_1_A}', '${EMPRESA_A}', '${LEAD_ETAPA_1_A}', 1),
         ('${OPORTUNIDADE_ETAPA_6_A}', '${EMPRESA_A}', '${LEAD_ETAPA_6_A}', 6),
         ('${OPORTUNIDADE_IDEMPOTENCIA_A}', '${EMPRESA_A}', '${LEAD_IDEMPOTENCIA_A}', 3);`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  // `psqlComo` imprime a tag de status do comando (`SELECT 1`, ...) junto
  // com a linha de dado mesmo com `-t -A`; descarta essas tags.
  const TAG_DE_COMANDO = /^(SET|BEGIN|COMMIT|ROLLBACK|INSERT \d+ \d+|UPDATE \d+|DELETE \d+)$/;
  function valorRetornado(stdout: string): string {
    return stdout
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => linha !== '' && !TAG_DE_COMANDO.test(linha))
      .join('\n');
  }

  function estadoOportunidade(id: string): string {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT "etapa_id", "version", "cadencia_encerrada_em" IS NOT NULL FROM "oportunidades" WHERE "id" = '${id}'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    return valorRetornado(resultado.stdout);
  }

  function contarEventosConexao(oportunidadeId: string): number {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${oportunidadeId}' AND "tipo" = 'conexao_whatsapp'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    return Number(valorRetornado(resultado.stdout));
  }

  function mensagensComId(empresaId: string, evolutionMessageId: string): string[] {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT "empresa_id" || '|' || coalesce("lead_id"::text, 'NULL') || '|' || "direcao"
       FROM "whatsapp_mensagens" WHERE "empresa_id" = '${empresaId}' AND "evolution_message_id" = '${evolutionMessageId}'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    const texto = valorRetornado(resultado.stdout);
    return texto === '' ? [] : texto.split('\n');
  }

  let contadorEvolutionId = 0;
  function proximoEvolutionId(): string {
    contadorEvolutionId += 1;
    return `evo-t068-${contadorEvolutionId}`;
  }

  describe('AC-125: o telefone do lead é reconhecido, inclusive com a variação do nono dígito', () => {
    test('número sem o nono dígito casa com o lead cadastrado com o nono dígito @spec:AC-125', async () => {
      const resultado = await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '559188884444', texto: 'oi sem o nono', evolutionMessageId: proximoEvolutionId() }
      );
      expect(resultado.leadId).toBe(LEAD_VARIACAO_A);
    });

    test('número com o nono dígito também casa com o mesmo lead @spec:AC-125', async () => {
      const resultado = await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5591988884444', texto: 'oi com o nono', evolutionMessageId: proximoEvolutionId() }
      );
      expect(resultado.leadId).toBe(LEAD_VARIACAO_A);
    });

    test('número que não casa com nenhum lead da empresa grava com lead_id nulo @spec:AC-125', async () => {
      const evolutionId = proximoEvolutionId();
      const resultado = await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5511900000000', texto: 'número desconhecido', evolutionMessageId: evolutionId }
      );
      expect(resultado.leadId).toBeNull();
      expect(mensagensComId(EMPRESA_A, evolutionId)).toEqual([`${EMPRESA_A}|NULL|recebida`]);
    });

    test('buscarLeadPorNumero devolve o mesmo lead para as duas variações @spec:AC-125', async () => {
      const semNono = await buscarLeadPorNumero(db, { empresaId: EMPRESA_A }, '559188884444');
      const comNono = await buscarLeadPorNumero(db, { empresaId: EMPRESA_A }, '5591988884444');
      expect(semNono?.id).toBe(LEAD_VARIACAO_A);
      expect(comNono?.id).toBe(LEAD_VARIACAO_A);
    });
  });

  describe('AC-126: a mensagem só se liga a lead da mesma empresa', () => {
    test('mesmo telefone em A e B: mensagem pelo webhook de A liga só ao lead de A, nada muda em B @spec:AC-126', async () => {
      const evolutionId = proximoEvolutionId();
      const resultado = await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585999985587', texto: 'oi, lead A', evolutionMessageId: evolutionId }
      );

      expect(resultado.leadId).toBe(LEAD_CADENCIA_A);
      expect(mensagensComId(EMPRESA_A, evolutionId)).toEqual([`${EMPRESA_A}|${LEAD_CADENCIA_A}|recebida`]);

      // Nada lido, gravado ou alterado na empresa B: nenhuma mensagem criada
      // lá e a oportunidade de B permanece intocada (ainda etapa 2, version 1,
      // sem evento de conexão) — mesmo tendo o MESMO telefone e MESMA etapa
      // de cadência que o card de A, que a esta altura já conectou.
      expect(mensagensComId(EMPRESA_B, evolutionId)).toEqual([]);
      expect(estadoOportunidade(OPORTUNIDADE_CADENCIA_B)).toBe('2|1|f');
      expect(contarEventosConexao(OPORTUNIDADE_CADENCIA_B)).toBe(0);
    });
  });

  describe('AC-129: fora da cadência, a mensagem não move card nenhum', () => {
    test('lead com oportunidade na etapa 1 (Entrada de leads): mensagem grava, card não se move @spec:AC-129', async () => {
      const evolutionId = proximoEvolutionId();
      const resultado = await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585977776666', texto: 'oi, ainda na entrada', evolutionMessageId: evolutionId }
      );

      expect(resultado.leadId).toBe(LEAD_ETAPA_1_A);
      expect(mensagensComId(EMPRESA_A, evolutionId)).toEqual([`${EMPRESA_A}|${LEAD_ETAPA_1_A}|recebida`]);
      expect(estadoOportunidade(OPORTUNIDADE_ETAPA_1_A)).toBe('1|1|f');
      expect(contarEventosConexao(OPORTUNIDADE_ETAPA_1_A)).toBe(0);
    });

    test('lead com oportunidade na etapa 6 (depois de Qualificando): mensagem grava, card não se move @spec:AC-129', async () => {
      const evolutionId = proximoEvolutionId();
      const resultado = await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585977775555', texto: 'oi, já qualificado', evolutionMessageId: evolutionId }
      );

      expect(resultado.leadId).toBe(LEAD_ETAPA_6_A);
      expect(mensagensComId(EMPRESA_A, evolutionId)).toEqual([`${EMPRESA_A}|${LEAD_ETAPA_6_A}|recebida`]);
      expect(estadoOportunidade(OPORTUNIDADE_ETAPA_6_A)).toBe('6|1|f');
      expect(contarEventosConexao(OPORTUNIDADE_ETAPA_6_A)).toBe(0);
    });

    test('lead sem nenhuma oportunidade: mensagem grava, nada quebra @spec:AC-129', async () => {
      const evolutionId = proximoEvolutionId();
      const resultado = await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585977774444', texto: 'oi, sem card', evolutionMessageId: evolutionId }
      );

      expect(resultado.leadId).toBe(LEAD_SEM_OPORTUNIDADE_A);
      expect(mensagensComId(EMPRESA_A, evolutionId)).toEqual([`${EMPRESA_A}|${LEAD_SEM_OPORTUNIDADE_A}|recebida`]);
    });
  });

  describe('AC-124: mensagem repetida não duplica', () => {
    test('retentativa com o mesmo evolution_message_id não insere linha nova nem conecta de novo @spec:AC-124', async () => {
      const evolutionId = proximoEvolutionId();

      const primeira = await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585966665555', texto: 'oi', evolutionMessageId: evolutionId }
      );
      expect(primeira.nova).toBe(true);
      expect(primeira.mensagemId).not.toBeNull();
      expect(primeira.leadId).toBe(LEAD_IDEMPOTENCIA_A);
      // Em cadência (etapa 3): a primeira mensagem nova deveria ter conectado.
      expect(estadoOportunidade(OPORTUNIDADE_IDEMPOTENCIA_A)).toBe('5|2|t');
      expect(contarEventosConexao(OPORTUNIDADE_IDEMPOTENCIA_A)).toBe(1);

      const retentativa = await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585966665555', texto: 'oi de novo (retentativa da Evolution)', evolutionMessageId: evolutionId }
      );
      expect(retentativa.nova).toBe(false);
      expect(retentativa.mensagemId).toBeNull();

      expect(mensagensComId(EMPRESA_A, evolutionId)).toEqual([`${EMPRESA_A}|${LEAD_IDEMPOTENCIA_A}|recebida`]);
      // Nenhum evento de conexão novo, nenhuma version nova.
      expect(estadoOportunidade(OPORTUNIDADE_IDEMPOTENCIA_A)).toBe('5|2|t');
      expect(contarEventosConexao(OPORTUNIDADE_IDEMPOTENCIA_A)).toBe(1);
    });
  });
});
