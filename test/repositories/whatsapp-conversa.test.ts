// Testes de T-076 (fase2c-whatsapp-conversa): histórico de conversa, não
// lidas, marcar como lida e registrar mensagem enviada
// (src/repositories/whatsapp.ts) — contra um Postgres 15 efêmero real com a
// migration 0009 aplicada (coluna `lida_em` e `lead_telefones`).
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  buscarHistoricoPorLead,
  buscarHistoricoPorNumero,
  listarConversasNaoLidas,
  marcarConversaComoLida,
  registrarMensagemEnviada,
  registrarMensagemRecebida,
} from '../../src/repositories/whatsapp';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA_A = 'd0000000-0000-0000-0000-000000000001';
const EMPRESA_B = 'd0000000-0000-0000-0000-000000000002';

// AC-148/AC-149: lead com telefone principal, mensagens enviadas e recebidas.
const LEAD_HISTORICO_A = 'd0000000-0000-0000-0000-00000000a001';

// AC-150: lead com principal + extra, mensagens em cada telefone.
const LEAD_VARIOS_TELEFONES_A = 'd0000000-0000-0000-0000-00000000a002';

// AC-151: mesmo número em A e B.
const LEAD_ISOLAMENTO_A = 'd0000000-0000-0000-0000-00000000a003';
const LEAD_ISOLAMENTO_B = 'd0000000-0000-0000-0000-00000000b003';

// AC-154/AC-155: conversas não lidas.
const LEAD_NAO_LIDAS_1_A = 'd0000000-0000-0000-0000-00000000a004';
const LEAD_NAO_LIDAS_2_A = 'd0000000-0000-0000-0000-00000000a005';
const LEAD_VARIOS_TEL_NAO_LIDAS_A = 'd0000000-0000-0000-0000-00000000a006';

// AC-157/AC-158/AC-159: marcar como lida.
const LEAD_MARCAR_LIDA_A = 'd0000000-0000-0000-0000-00000000a007';
const LEAD_OUTRA_CONVERSA_A = 'd0000000-0000-0000-0000-00000000a008';

describe('T-076: histórico, não lidas, marcar como lida e registrar enviada', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A Conversa', 'empresa-a-conversa'),
         ('${EMPRESA_B}', 'Empresa B Conversa', 'empresa-b-conversa');

       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES
         ('${LEAD_HISTORICO_A}', '${EMPRESA_A}', 'Lead Histórico A', '+5585911110001'),
         ('${LEAD_VARIOS_TELEFONES_A}', '${EMPRESA_A}', 'Lead Vários Telefones A', '+5585911110002'),
         ('${LEAD_ISOLAMENTO_A}', '${EMPRESA_A}', 'Lead Isolamento A', '+5585911110003'),
         ('${LEAD_ISOLAMENTO_B}', '${EMPRESA_B}', 'Lead Isolamento B', '+5585911110003'),
         ('${LEAD_NAO_LIDAS_1_A}', '${EMPRESA_A}', 'Lead Não Lidas 1 A', '+5585911110004'),
         ('${LEAD_NAO_LIDAS_2_A}', '${EMPRESA_A}', 'Lead Não Lidas 2 A', '+5585911110005'),
         ('${LEAD_VARIOS_TEL_NAO_LIDAS_A}', '${EMPRESA_A}', 'Lead Vários Tel Não Lidas A', '+5585911110006'),
         ('${LEAD_MARCAR_LIDA_A}', '${EMPRESA_A}', 'Lead Marcar Lida A', '+5585911110007'),
         ('${LEAD_OUTRA_CONVERSA_A}', '${EMPRESA_A}', 'Lead Outra Conversa A', '+5585911110008');

       INSERT INTO "lead_telefones" ("id", "empresa_id", "lead_id", "numero", "rotulo") VALUES
         ('d0000000-0000-0000-0000-0000000000e1', '${EMPRESA_A}', '${LEAD_VARIOS_TELEFONES_A}', '5585922220002', 'Recepção'),
         ('d0000000-0000-0000-0000-0000000000e2', '${EMPRESA_A}', '${LEAD_VARIOS_TEL_NAO_LIDAS_A}', '5585922220006', 'Recepção');`
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

  let contadorEvolutionId = 0;
  function proximoEvolutionId(): string {
    contadorEvolutionId += 1;
    return `evo-t076-${contadorEvolutionId}`;
  }

  // `psqlComo` imprime a tag de status do comando junto com a linha de dado
  // mesmo com `-t -A`; descarta essas tags (mesmo padrão dos demais testes de whatsapp).
  const TAG_DE_COMANDO = /^(SET|BEGIN|COMMIT|ROLLBACK|INSERT \d+ \d+|UPDATE \d+|DELETE \d+)$/;
  function valorRetornado(stdout: string): string {
    return stdout
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => linha !== '' && !TAG_DE_COMANDO.test(linha))
      .join('\n');
  }

  function inserirMensagemBruta(opcoes: {
    empresaId: string;
    leadId: string | null;
    numero: string;
    mensagem: string;
    direcao: 'enviada' | 'recebida';
    criadoEm: string;
    lidaEm?: string | null;
  }): void {
    const leadIdSql = opcoes.leadId ? `'${opcoes.leadId}'` : 'NULL';
    const lidaEmSql = opcoes.lidaEm === undefined ? 'NULL' : opcoes.lidaEm === null ? 'NULL' : `'${opcoes.lidaEm}'`;
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "whatsapp_mensagens"
         ("empresa_id", "lead_id", "numero", "mensagem", "direcao", "criado_em", "lida_em")
       VALUES
         ('${opcoes.empresaId}', ${leadIdSql}, '${opcoes.numero}', '${opcoes.mensagem}', '${opcoes.direcao}', '${opcoes.criadoEm}', ${lidaEmSql})`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
  }

  describe('AC-148: histórico por número traz enviadas e recebidas em ordem', () => {
    test('enviadas e recebidas do mesmo número aparecem da mais antiga para a mais recente, com os campos do legado @spec:AC-148', async () => {
      const numero = '5585911119001';
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: null,
        numero,
        mensagem: 'primeira (recebida)',
        direcao: 'recebida',
        criadoEm: '2026-01-01T10:00:00Z',
        lidaEm: '2026-01-01T10:05:00Z',
      });
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: null,
        numero,
        mensagem: 'segunda (enviada)',
        direcao: 'enviada',
        criadoEm: '2026-01-01T10:05:00Z',
      });
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: null,
        numero,
        mensagem: 'terceira (recebida)',
        direcao: 'recebida',
        criadoEm: '2026-01-01T10:10:00Z',
      });

      const historico = await buscarHistoricoPorNumero(db, { empresaId: EMPRESA_A }, numero);

      expect(historico.map((m) => m.mensagem)).toEqual(['primeira (recebida)', 'segunda (enviada)', 'terceira (recebida)']);
      expect(historico[0]).toMatchObject({
        direcao: 'recebida',
        numero,
        status: 'entregue',
      });
      expect(historico[0].id).toBeTruthy();
      expect(historico[0].created_at).toBeInstanceOf(Date);
      expect(historico[1]).toMatchObject({ direcao: 'enviada', numero, status: 'entregue' });
      // Ordem cronológica: cada `created_at` é maior ou igual ao anterior.
      for (let i = 1; i < historico.length; i += 1) {
        expect(historico[i].created_at.getTime()).toBeGreaterThanOrEqual(historico[i - 1].created_at.getTime());
      }
    });

    test('limita às 200 mensagens mais recentes @spec:AC-148', async () => {
      const numero = '5585911119002';
      const resultado = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "whatsapp_mensagens" ("empresa_id", "numero", "mensagem", "direcao", "criado_em")
         SELECT '${EMPRESA_A}', '${numero}', 'msg-' || i, 'recebida',
                TIMESTAMP '2026-02-01T00:00:00Z' + (i * INTERVAL '1 second')
         FROM generate_series(1, 205) AS i`
      );
      if (resultado.status !== 0) throw new Error(resultado.stderr);

      const historico = await buscarHistoricoPorNumero(db, { empresaId: EMPRESA_A }, numero);

      expect(historico).toHaveLength(200);
      expect(historico[0].mensagem).toBe('msg-6');
      expect(historico[historico.length - 1].mensagem).toBe('msg-205');
    });
  });

  describe('AC-149: o número é reconhecido com a variação do nono dígito', () => {
    test('consultar com ou sem o nono dígito devolve a união das duas grafias @spec:AC-149', async () => {
      const comNono = '5585999985588';
      const semNono = '558599985588';

      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: null,
        numero: comNono,
        mensagem: 'grafia com nono',
        direcao: 'recebida',
        criadoEm: '2026-01-02T10:00:00Z',
      });
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: null,
        numero: semNono,
        mensagem: 'grafia sem nono',
        direcao: 'recebida',
        criadoEm: '2026-01-02T10:01:00Z',
      });

      const porComNono = await buscarHistoricoPorNumero(db, { empresaId: EMPRESA_A }, comNono);
      const porSemNono = await buscarHistoricoPorNumero(db, { empresaId: EMPRESA_A }, semNono);

      expect(porComNono.map((m) => m.mensagem)).toEqual(['grafia com nono', 'grafia sem nono']);
      expect(porSemNono.map((m) => m.mensagem)).toEqual(['grafia com nono', 'grafia sem nono']);
    });
  });

  describe('AC-150: histórico por lead reúne todos os telefones do lead', () => {
    test('mensagens do principal e do extra aparecem juntas, em ordem, sem repetir @spec:AC-150', async () => {
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_VARIOS_TELEFONES_A,
        numero: '5585911110002',
        mensagem: 'pelo principal',
        direcao: 'recebida',
        criadoEm: '2026-01-03T10:00:00Z',
      });
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_VARIOS_TELEFONES_A,
        numero: '5585922220002',
        mensagem: 'pelo extra',
        direcao: 'recebida',
        criadoEm: '2026-01-03T10:05:00Z',
      });
      // Mensagem antiga: lead_id já ligado, mas o número não é mais nenhum dos telefones atuais do lead.
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_VARIOS_TELEFONES_A,
        numero: '5585933330000',
        mensagem: 'ligada só pelo lead_id',
        direcao: 'recebida',
        criadoEm: '2026-01-03T10:10:00Z',
      });

      const historico = await buscarHistoricoPorLead(db, { empresaId: EMPRESA_A }, LEAD_VARIOS_TELEFONES_A);

      expect(historico.map((m) => m.mensagem)).toEqual(['pelo principal', 'pelo extra', 'ligada só pelo lead_id']);
      expect(new Set(historico.map((m) => m.id)).size).toBe(historico.length);
    });
  });

  describe('AC-151: histórico nunca mostra mensagens de outra empresa', () => {
    test('mesmo número em A e B: cada empresa só vê as suas, por número e por leadId @spec:AC-151', async () => {
      const numeroCompartilhado = '5585911110003';
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_ISOLAMENTO_A,
        numero: numeroCompartilhado,
        mensagem: 'mensagem da empresa A',
        direcao: 'recebida',
        criadoEm: '2026-01-04T10:00:00Z',
      });
      inserirMensagemBruta({
        empresaId: EMPRESA_B,
        leadId: LEAD_ISOLAMENTO_B,
        numero: numeroCompartilhado,
        mensagem: 'mensagem da empresa B',
        direcao: 'recebida',
        criadoEm: '2026-01-04T10:00:00Z',
      });

      const historicoPorNumeroA = await buscarHistoricoPorNumero(db, { empresaId: EMPRESA_A }, numeroCompartilhado);
      expect(historicoPorNumeroA.map((m) => m.mensagem)).toEqual(['mensagem da empresa A']);

      const historicoPorLeadDaB_sobA = await buscarHistoricoPorLead(db, { empresaId: EMPRESA_A }, LEAD_ISOLAMENTO_B);
      expect(historicoPorLeadDaB_sobA).toEqual([]);
    });
  });

  describe('AC-154 e AC-155: não lidas por conversa', () => {
    test('agrupa por lead e por número, só com as recebidas não lidas, da mais recente para a mais antiga @spec:AC-154', async () => {
      // Lead 1: duas não lidas (count=2) + uma enviada (não conta) + uma recebida já lida (não conta).
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_NAO_LIDAS_1_A,
        numero: '5585911110004',
        mensagem: 'não lida 1a',
        direcao: 'recebida',
        criadoEm: '2026-01-05T10:00:00Z',
      });
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_NAO_LIDAS_1_A,
        numero: '5585911110004',
        mensagem: 'não lida 1b (mais recente)',
        direcao: 'recebida',
        criadoEm: '2026-01-05T10:05:00Z',
      });
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_NAO_LIDAS_1_A,
        numero: '5585911110004',
        mensagem: 'enviada, não conta',
        direcao: 'enviada',
        criadoEm: '2026-01-05T10:06:00Z',
      });
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_NAO_LIDAS_1_A,
        numero: '5585911110004',
        mensagem: 'já lida, não conta',
        direcao: 'recebida',
        criadoEm: '2026-01-05T09:00:00Z',
        lidaEm: '2026-01-05T09:30:00Z',
      });

      // Lead 2: uma não lida.
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_NAO_LIDAS_2_A,
        numero: '5585911110005',
        mensagem: 'não lida lead 2',
        direcao: 'recebida',
        criadoEm: '2026-01-05T11:00:00Z',
      });

      // Número avulso: uma não lida.
      const numeroAvulso = '5585911119999';
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: null,
        numero: numeroAvulso,
        mensagem: 'não lida avulso',
        direcao: 'recebida',
        criadoEm: '2026-01-05T09:30:00Z',
      });

      const conversas = await listarConversasNaoLidas(db, { empresaId: EMPRESA_A });
      const porLead1 = conversas.find((c) => c.leadId === LEAD_NAO_LIDAS_1_A);
      const porLead2 = conversas.find((c) => c.leadId === LEAD_NAO_LIDAS_2_A);
      const porAvulso = conversas.find((c) => c.numero === numeroAvulso);

      expect(porLead1).toMatchObject({ count: 2, lastMessage: 'não lida 1b (mais recente)' });
      expect(porLead2).toMatchObject({ count: 1, lastMessage: 'não lida lead 2' });
      expect(porAvulso).toMatchObject({ count: 1, leadId: null, lastMessage: 'não lida avulso' });

      // Ordem: da mais recente para a mais antiga.
      const indiceLead2 = conversas.indexOf(porLead2!);
      const indiceLead1 = conversas.indexOf(porLead1!);
      expect(indiceLead2).toBeLessThan(indiceLead1);
    });

    test('telefones diferentes do mesmo lead e grafias diferentes do mesmo avulso contam como uma conversa só @spec:AC-155', async () => {
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_VARIOS_TEL_NAO_LIDAS_A,
        numero: '5585911110006',
        mensagem: 'pelo principal',
        direcao: 'recebida',
        criadoEm: '2026-01-06T10:00:00Z',
      });
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_VARIOS_TEL_NAO_LIDAS_A,
        numero: '5585922220006',
        mensagem: 'pelo extra',
        direcao: 'recebida',
        criadoEm: '2026-01-06T10:05:00Z',
      });

      const comNono = '5585999985577';
      const semNono = '558599985577';
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: null,
        numero: comNono,
        mensagem: 'avulso com nono',
        direcao: 'recebida',
        criadoEm: '2026-01-06T11:00:00Z',
      });
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: null,
        numero: semNono,
        mensagem: 'avulso sem nono',
        direcao: 'recebida',
        criadoEm: '2026-01-06T11:05:00Z',
      });

      const conversas = await listarConversasNaoLidas(db, { empresaId: EMPRESA_A });
      const doLead = conversas.filter((c) => c.leadId === LEAD_VARIOS_TEL_NAO_LIDAS_A);
      const doAvulso = conversas.filter((c) => c.numero === comNono || c.numero === semNono);

      expect(doLead).toHaveLength(1);
      expect(doLead[0].count).toBe(2);
      expect(doAvulso).toHaveLength(1);
      expect(doAvulso[0].count).toBe(2);
    });
  });

  describe('AC-157, AC-158 e AC-159: marcar como lida', () => {
    test('marca as recebidas da conversa do lead; some de não lidas; idempotente; outra conversa e outra empresa continuam intocadas @spec:AC-157', async () => {
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_MARCAR_LIDA_A,
        numero: '5585911110007',
        mensagem: 'para marcar 1',
        direcao: 'recebida',
        criadoEm: '2026-01-07T10:00:00Z',
      });
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_MARCAR_LIDA_A,
        numero: '5585911110007',
        mensagem: 'para marcar 2',
        direcao: 'recebida',
        criadoEm: '2026-01-07T10:05:00Z',
      });
      // Outra conversa na mesma empresa — não deve ser tocada.
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: LEAD_OUTRA_CONVERSA_A,
        numero: '5585911110008',
        mensagem: 'outra conversa',
        direcao: 'recebida',
        criadoEm: '2026-01-07T09:00:00Z',
      });
      // Mesmo número, outra empresa — não deve ser tocada.
      inserirMensagemBruta({
        empresaId: EMPRESA_B,
        leadId: null,
        numero: '5585911110007',
        mensagem: 'mesma numero outra empresa',
        direcao: 'recebida',
        criadoEm: '2026-01-07T09:00:00Z',
      });

      const antes = await listarConversasNaoLidas(db, { empresaId: EMPRESA_A });
      expect(antes.some((c) => c.leadId === LEAD_MARCAR_LIDA_A)).toBe(true);

      const primeira = await marcarConversaComoLida(db, { empresaId: EMPRESA_A }, { leadId: LEAD_MARCAR_LIDA_A });
      expect(primeira).toBe(2);

      const depois = await listarConversasNaoLidas(db, { empresaId: EMPRESA_A });
      expect(depois.some((c) => c.leadId === LEAD_MARCAR_LIDA_A)).toBe(false);
      // Outra conversa continua não lida.
      expect(depois.some((c) => c.leadId === LEAD_OUTRA_CONVERSA_A)).toBe(true);
      // Outra empresa continua com a sua.
      const outraEmpresa = await listarConversasNaoLidas(db, { empresaId: EMPRESA_B });
      expect(outraEmpresa.some((c) => c.numero === '5585911110007')).toBe(true);

      // AC-158: segunda chamada idempotente, devolve 0.
      const segunda = await marcarConversaComoLida(db, { empresaId: EMPRESA_A }, { leadId: LEAD_MARCAR_LIDA_A });
      expect(segunda).toBe(0);

      // AC-159: mensagem nova depois de lida volta a contar, só ela.
      await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585911110007', texto: 'nova depois de lida', evolutionMessageId: proximoEvolutionId() }
      );
      const depoisDaNova = await listarConversasNaoLidas(db, { empresaId: EMPRESA_A });
      const conversaNova = depoisDaNova.find((c) => c.leadId === LEAD_MARCAR_LIDA_A);
      expect(conversaNova).toMatchObject({ count: 1, lastMessage: 'nova depois de lida' });
    });

    test('marca como lida por número avulso sem tocar em conversa de lead com o mesmo número como extra @spec:AC-158', async () => {
      const numeroAvulsoMarcar = '5585911129000';
      inserirMensagemBruta({
        empresaId: EMPRESA_A,
        leadId: null,
        numero: numeroAvulsoMarcar,
        mensagem: 'avulso para marcar',
        direcao: 'recebida',
        criadoEm: '2026-01-08T10:00:00Z',
      });

      const marcadas = await marcarConversaComoLida(db, { empresaId: EMPRESA_A }, { numero: numeroAvulsoMarcar });
      expect(marcadas).toBe(1);

      const conversas = await listarConversasNaoLidas(db, { empresaId: EMPRESA_A });
      expect(conversas.some((c) => c.numero === numeroAvulsoMarcar)).toBe(false);

      const segunda = await marcarConversaComoLida(db, { empresaId: EMPRESA_A }, { numero: numeroAvulsoMarcar });
      expect(segunda).toBe(0);
    });
  });

  describe('registrarMensagemEnviada', () => {
    test('liga a mensagem enviada ao lead dono do número (principal ou extra) e grava sem lead quando o número é avulso', async () => {
      const paraPrincipal = await registrarMensagemEnviada(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585911110001', texto: 'oi', evolutionMessageId: proximoEvolutionId() }
      );
      expect(paraPrincipal.leadId).toBe(LEAD_HISTORICO_A);

      const paraExtra = await registrarMensagemEnviada(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585922220002', texto: 'oi recepção', evolutionMessageId: proximoEvolutionId() }
      );
      expect(paraExtra.leadId).toBe(LEAD_VARIOS_TELEFONES_A);

      const avulso = await registrarMensagemEnviada(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585911100000', texto: 'oi desconhecido', evolutionMessageId: proximoEvolutionId() }
      );
      expect(avulso.leadId).toBeNull();
    });
  });
});
