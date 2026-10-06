// Testes de T-069 (fase2c-whatsapp-entrada, US-039): rota
// POST /api/whatsapp/webhook — webhook sem sessão da Evolution API, contra um
// Postgres 15 efêmero real com a migration 0008 aplicada (mesmos moldes de
// test/repositories/whatsapp.test.ts, T-068). `registrarMensagemRecebida` é
// parcialmente mockado (preserva a implementação real por padrão) só para a
// prova de AC-131, que precisa de uma falha de banco no meio do processamento
// sem depender de um gatilho real de erro do Postgres.
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

vi.mock('../../src/repositories/whatsapp', async (importarOriginal) => {
  const original = await importarOriginal<typeof import('../../src/repositories/whatsapp')>();
  return {
    ...original,
    registrarMensagemRecebida: vi.fn(original.registrarMensagemRecebida),
  };
});

const EMPRESA_COM_SEGREDO = 'e0000000-0000-0000-0000-000000000001';
const EMPRESA_SEM_SEGREDO = 'e0000000-0000-0000-0000-000000000002';
const EMPRESA_INEXISTENTE = 'e0000000-0000-0000-0000-00000000dead';
const SEGREDO_CORRETO = 'segredo-correto-123';
const LEAD_A = 'e0000000-0000-0000-0000-00000000a001';

function postWebhook(query: string, corpo: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/whatsapp/webhook${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

function postWebhookCorpoCru(query: string, corpoCru: string): NextRequest {
  return new NextRequest(`http://localhost/api/whatsapp/webhook${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: corpoCru,
  });
}

function eventoMensagem(remoteJid: string, texto: string, evolutionMessageId: string) {
  return {
    event: 'messages.upsert',
    data: { key: { remoteJid, id: evolutionMessageId }, message: { conversation: texto } },
  };
}

describe('T-069: rota POST /api/whatsapp/webhook', () => {
  let pg: PostgresEfemero;
  let routeModule: typeof import('../../src/app/api/whatsapp/webhook/route');
  let repositorioWhatsapp: typeof import('../../src/repositories/whatsapp');

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_COM_SEGREDO}', 'Empresa Com Segredo', 'empresa-com-segredo'),
         ('${EMPRESA_SEM_SEGREDO}', 'Empresa Sem Segredo', 'empresa-sem-segredo');

       INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor") VALUES
         ('${EMPRESA_COM_SEGREDO}', 'evolution_webhook_secret', '"${SEGREDO_CORRETO}"'::jsonb);

       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES
         ('${LEAD_A}', '${EMPRESA_COM_SEGREDO}', 'Lead A', '+5585999985587');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);
    }

    process.env.DATABASE_URL = pg.appUrl;
    routeModule = await import('../../src/app/api/whatsapp/webhook/route');
    repositorioWhatsapp = await import('../../src/repositories/whatsapp');
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    pg?.parar();
  });

  function mensagensComId(evolutionMessageId: string): string[] {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT "numero" FROM "whatsapp_mensagens" WHERE "evolution_message_id" = '${evolutionMessageId}'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    return resultado.stdout
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => linha !== '');
  }

  let contador = 0;
  function proximoEvolutionId(): string {
    contador += 1;
    return `evo-t069-${contador}`;
  }

  describe('AC-119: sem segredo cadastrado ou segredo errado, o webhook recusa', () => {
    test('empresa sem nenhum segredo cadastrado: 401, nada gravado @spec:AC-119', async () => {
      const evolutionId = proximoEvolutionId();
      const resposta = await routeModule.POST(
        postWebhook(
          `?empresa_id=${EMPRESA_SEM_SEGREDO}&secret=qualquer-coisa`,
          eventoMensagem('558599990001@s.whatsapp.net', 'oi', evolutionId)
        )
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(401);
      expect(corpo.codigo).toBe('NAO_AUTORIZADO');
      expect(mensagensComId(evolutionId)).toEqual([]);
    });

    test('secret ausente para empresa com segredo cadastrado: 401, nada gravado @spec:AC-119', async () => {
      const evolutionId = proximoEvolutionId();
      const resposta = await routeModule.POST(
        postWebhook(`?empresa_id=${EMPRESA_COM_SEGREDO}`, eventoMensagem('558599990002@s.whatsapp.net', 'oi', evolutionId))
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(401);
      expect(corpo.codigo).toBe('NAO_AUTORIZADO');
      expect(mensagensComId(evolutionId)).toEqual([]);
    });

    test('secret errado para empresa com segredo cadastrado: 401, nada gravado @spec:AC-119', async () => {
      const evolutionId = proximoEvolutionId();
      const resposta = await routeModule.POST(
        postWebhook(
          `?empresa_id=${EMPRESA_COM_SEGREDO}&secret=segredo-errado`,
          eventoMensagem('558599990003@s.whatsapp.net', 'oi', evolutionId)
        )
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(401);
      expect(corpo.codigo).toBe('NAO_AUTORIZADO');
      expect(mensagensComId(evolutionId)).toEqual([]);
    });
  });

  describe('AC-120: segredo correto é aceito', () => {
    test('secret correto com evento de mensagem válido: 200 e a mensagem é processada @spec:AC-120', async () => {
      const evolutionId = proximoEvolutionId();
      const resposta = await routeModule.POST(
        postWebhook(
          `?empresa_id=${EMPRESA_COM_SEGREDO}&secret=${SEGREDO_CORRETO}`,
          eventoMensagem('5585999985587@s.whatsapp.net', 'oi, lead A', evolutionId)
        )
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.ok).toBe(true);
      expect(mensagensComId(evolutionId)).toEqual(['5585999985587']);
    });
  });

  describe('AC-121: parâmetros e corpo inválidos são recusados com erro claro', () => {
    test('sem empresa_id: 400, nada gravado @spec:AC-121', async () => {
      const evolutionId = proximoEvolutionId();
      const resposta = await routeModule.POST(postWebhook('', eventoMensagem('558599990004@s.whatsapp.net', 'oi', evolutionId)));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(400);
      expect(corpo.codigo).toBe('REQUISICAO_INVALIDA');
      expect(mensagensComId(evolutionId)).toEqual([]);
    });

    test('empresa_id que não é UUID: 400, nada gravado @spec:AC-121', async () => {
      const evolutionId = proximoEvolutionId();
      const resposta = await routeModule.POST(
        postWebhook(
          `?empresa_id=nao-e-um-uuid&secret=${SEGREDO_CORRETO}`,
          eventoMensagem('558599990005@s.whatsapp.net', 'oi', evolutionId)
        )
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(400);
      expect(corpo.codigo).toBe('REQUISICAO_INVALIDA');
      expect(mensagensComId(evolutionId)).toEqual([]);
    });

    test('empresa_id com formato de UUID mas inexistente: 401, sem revelar que ela não existe @spec:AC-121', async () => {
      const evolutionId = proximoEvolutionId();
      const resposta = await routeModule.POST(
        postWebhook(
          `?empresa_id=${EMPRESA_INEXISTENTE}&secret=qualquer-coisa`,
          eventoMensagem('558599990006@s.whatsapp.net', 'oi', evolutionId)
        )
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(401);
      expect(corpo.codigo).toBe('NAO_AUTORIZADO');
      expect(mensagensComId(evolutionId)).toEqual([]);
    });

    test('corpo que não é JSON: 400, nada gravado @spec:AC-121', async () => {
      const resposta = await routeModule.POST(
        postWebhookCorpoCru(`?empresa_id=${EMPRESA_COM_SEGREDO}&secret=${SEGREDO_CORRETO}`, '{isso não é json')
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(400);
      expect(corpo.codigo).toBe('REQUISICAO_INVALIDA');
    });
  });

  describe('AC-131: mensagem e conexão são atômicas', () => {
    test('falha de banco simulada no 2º item do array: 500; o 1º item (transação própria, já concluída) permanece gravado, o 2º não @spec:AC-131', async () => {
      const evolutionIdOk = proximoEvolutionId();
      const evolutionIdFalha = proximoEvolutionId();

      const original = await vi.importActual<typeof import('../../src/repositories/whatsapp')>(
        '../../src/repositories/whatsapp'
      );
      const mockRegistrar = repositorioWhatsapp.registrarMensagemRecebida as unknown as ReturnType<typeof vi.fn>;
      // 1ª chamada (1º item do array) usa a implementação real e deve ter
      // sucesso; só a 2ª chamada (2º item) falha — prova que a rota processa
      // cada item numa transação própria (notas de T-069), não um "tudo ou
      // nada" do payload inteiro.
      mockRegistrar
        .mockImplementationOnce(original.registrarMensagemRecebida)
        .mockRejectedValueOnce(new Error('erro de banco simulado (AC-131)'));

      const resposta = await routeModule.POST(
        postWebhook(`?empresa_id=${EMPRESA_COM_SEGREDO}&secret=${SEGREDO_CORRETO}`, {
          event: 'messages.upsert',
          data: [
            eventoMensagem('558599990007@s.whatsapp.net', 'primeira', evolutionIdOk).data,
            eventoMensagem('558599990008@s.whatsapp.net', 'segunda', evolutionIdFalha).data,
          ],
        })
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(500);
      expect(corpo.codigo).toBe('ERRO_INTERNO');
      // Primeiro item: já tinha a própria transação concluída quando o
      // segundo falhou — permanece gravado.
      expect(mensagensComId(evolutionIdOk)).toEqual(['558599990007']);
      // Segundo item: a chamada que falhou (mockada) — nada gravado.
      expect(mensagensComId(evolutionIdFalha)).toEqual([]);
    });
  });
});
