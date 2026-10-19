// Testes de T-106 (fase2d-campanhas, US-067): rota POST /api/webhooks/resend
// — webhook sem sessão do Resend, contra um Postgres 15 efêmero real (mesmo
// harness de test/api/whatsapp-webhook.test.ts). A campanha/destinatário
// entram via `crm_migrator` (bypassa RLS, como o motor em Python faria ao
// marcar ENVIADO — ASM-075); a rota sob teste usa a conexão `crm_app` (RLS
// ativo), como em produção. A assinatura é calculada aqui com o mesmo HMAC
// Svix que `verificarAssinaturaResend` espera, para não depender da própria
// função sob teste.
import { createHmac } from 'node:crypto';

import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const SEGREDO = 'whsec_c2VncmVkby1kZS10ZXN0ZS1yZXNlbmQtdDEwNg==';
const EMPRESA_A = 'e0000000-0000-0000-0000-0000000a0001';
const EMPRESA_B = 'e0000000-0000-0000-0000-0000000a0002';

function assinar(corpoCru: string, svixId: string, svixTimestamp: string, segredo = SEGREDO): string {
  const segredoBase64 = segredo.startsWith('whsec_') ? segredo.slice('whsec_'.length) : segredo;
  const chave = Buffer.from(segredoBase64, 'base64');
  const assinatura = createHmac('sha256', chave).update(`${svixId}.${svixTimestamp}.${corpoCru}`).digest('base64');
  return `v1,${assinatura}`;
}

function postWebhook(
  corpo: unknown,
  opcoes: { semAssinatura?: boolean; segredoErrado?: boolean } = {}
): NextRequest {
  const corpoCru = JSON.stringify(corpo);
  const svixId = 'msg_t106';
  const svixTimestamp = '1700000000';

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!opcoes.semAssinatura) {
    headers['svix-id'] = svixId;
    headers['svix-timestamp'] = svixTimestamp;
    headers['svix-signature'] = assinar(
      corpoCru,
      svixId,
      svixTimestamp,
      opcoes.segredoErrado ? 'whsec_c2VncmVkby1lcnJhZG8tdDEwNg==' : SEGREDO
    );
  }

  return new NextRequest('http://localhost/api/webhooks/resend', {
    method: 'POST',
    headers,
    body: corpoCru,
  });
}

function eventoAbertura(envioId: string | null, empresaId: string | null, tipo = 'email.opened') {
  const tags: Array<{ name: string; value: string }> = [];
  if (envioId) tags.push({ name: 'envio_id', value: envioId });
  if (empresaId) tags.push({ name: 'empresa_id', value: empresaId });
  return { type: tipo, data: { tags } };
}

describe('T-106: rota POST /api/webhooks/resend', () => {
  let pg: PostgresEfemero;
  let routeModule: typeof import('../../src/app/api/webhooks/resend/route');

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa Webhook Resend A', 'empresa-webhook-resend-a'),
         ('${EMPRESA_B}', 'Empresa Webhook Resend B', 'empresa-webhook-resend-b');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);
    }

    process.env.DATABASE_URL = pg.appUrl;
    process.env.RESEND_WEBHOOK_SECRET = SEGREDO;
    routeModule = await import('../../src/app/api/webhooks/resend/route');
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    pg?.parar();
  });

  let contador = 0;
  function proximoUuid(): string {
    contador += 1;
    return `e0000000-0000-0000-0000-${contador.toString(16).padStart(12, '0')}`;
  }

  function criarCampanhaEEnvio(empresaId: string, statusEnvio: string): { campanhaId: string; envioId: string } {
    const campanhaId = proximoUuid();
    const envioId = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "campanhas" ("id", "empresa_id", "nome", "assunto", "corpo_html", "status")
         VALUES ('${campanhaId}', '${empresaId}', 'Campanha teste', 'Assunto', '<p>oi</p>', 'PROCESSANDO');
       INSERT INTO "envios_campanha" ("id", "empresa_id", "campanha_id", "nome_destinatario", "email_destinatario", "status")
         VALUES ('${envioId}', '${empresaId}', '${campanhaId}', 'Fulano', 'fulano@teste.local', '${statusEnvio}');`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao preparar campanha/envio fixture: ${resultado.stderr}`);
    }
    return { campanhaId, envioId };
  }

  function statusDoEnvio(envioId: string): string {
    const resultado = pg.psqlComo('crm_migrator', `SELECT status FROM envios_campanha WHERE id = '${envioId}'`);
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    return resultado.stdout.trim();
  }

  describe('AC-246: abertura e clique atualizam o destinatário', () => {
    test('email.opened leva ENVIADO a ABERTO @spec:AC-246', async () => {
      const { envioId } = criarCampanhaEEnvio(EMPRESA_A, 'ENVIADO');

      const resposta = await routeModule.POST(postWebhook(eventoAbertura(envioId, EMPRESA_A, 'email.opened')));

      expect(resposta.status).toBe(200);
      expect(statusDoEnvio(envioId)).toBe('ABERTO');
    });

    test('email.opened nunca rebaixa um CLICADO @spec:AC-246', async () => {
      const { envioId } = criarCampanhaEEnvio(EMPRESA_A, 'CLICADO');

      const resposta = await routeModule.POST(postWebhook(eventoAbertura(envioId, EMPRESA_A, 'email.opened')));

      expect(resposta.status).toBe(200);
      expect(statusDoEnvio(envioId)).toBe('CLICADO');
    });

    test('email.clicked leva ENVIADO a CLICADO @spec:AC-246', async () => {
      const { envioId } = criarCampanhaEEnvio(EMPRESA_A, 'ENVIADO');

      const resposta = await routeModule.POST(postWebhook(eventoAbertura(envioId, EMPRESA_A, 'email.clicked')));

      expect(resposta.status).toBe(200);
      expect(statusDoEnvio(envioId)).toBe('CLICADO');
    });

    test('email.clicked leva ABERTO a CLICADO @spec:AC-246', async () => {
      const { envioId } = criarCampanhaEEnvio(EMPRESA_A, 'ABERTO');

      const resposta = await routeModule.POST(postWebhook(eventoAbertura(envioId, EMPRESA_A, 'email.clicked')));

      expect(resposta.status).toBe(200);
      expect(statusDoEnvio(envioId)).toBe('CLICADO');
    });
  });

  describe('AC-247: webhook sem assinatura válida é recusado', () => {
    test('sem nenhum cabeçalho de assinatura: 401, nada alterado @spec:AC-247', async () => {
      const { envioId } = criarCampanhaEEnvio(EMPRESA_A, 'ENVIADO');

      const resposta = await routeModule.POST(
        postWebhook(eventoAbertura(envioId, EMPRESA_A, 'email.opened'), { semAssinatura: true })
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(401);
      expect(corpo.codigo).toBe('ASSINATURA_INVALIDA');
      expect(statusDoEnvio(envioId)).toBe('ENVIADO');
    });

    test('assinatura que não confere (segredo errado): 401, nada alterado @spec:AC-247', async () => {
      const { envioId } = criarCampanhaEEnvio(EMPRESA_A, 'ENVIADO');

      const resposta = await routeModule.POST(
        postWebhook(eventoAbertura(envioId, EMPRESA_A, 'email.opened'), { segredoErrado: true })
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(401);
      expect(corpo.codigo).toBe('ASSINATURA_INVALIDA');
      expect(statusDoEnvio(envioId)).toBe('ENVIADO');
    });
  });

  describe('AC-248: eventos desconhecidos ou sem envio são ignorados com 200', () => {
    test('tipo de evento não tratado: 200, nada alterado @spec:AC-248', async () => {
      const { envioId } = criarCampanhaEEnvio(EMPRESA_A, 'ENVIADO');

      const resposta = await routeModule.POST(postWebhook(eventoAbertura(envioId, EMPRESA_A, 'email.bounced')));

      expect(resposta.status).toBe(200);
      expect(statusDoEnvio(envioId)).toBe('ENVIADO');
    });

    test('sem envio_id nas tags: 200, nada alterado @spec:AC-248', async () => {
      const resposta = await routeModule.POST(postWebhook(eventoAbertura(null, EMPRESA_A, 'email.opened')));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.ok).toBe(true);
    });

    test('envio_id que não existe: 200, nada alterado @spec:AC-248', async () => {
      const envioInexistente = proximoUuid();

      const resposta = await routeModule.POST(
        postWebhook(eventoAbertura(envioInexistente, EMPRESA_A, 'email.opened'))
      );

      expect(resposta.status).toBe(200);
      expect(statusDoEnvio(envioInexistente)).toBe('');
    });

    test('envio_id existe mas em outra empresa: 200, nada alterado @spec:AC-248', async () => {
      const { envioId } = criarCampanhaEEnvio(EMPRESA_A, 'ENVIADO');

      const resposta = await routeModule.POST(postWebhook(eventoAbertura(envioId, EMPRESA_B, 'email.opened')));

      expect(resposta.status).toBe(200);
      expect(statusDoEnvio(envioId)).toBe('ENVIADO');
    });

    test('corpo que não é JSON válido: 200, nada alterado @spec:AC-248', async () => {
      const svixId = 'msg_t106_corpo_invalido';
      const svixTimestamp = '1700000001';
      const corpoCru = '{isso não é json';
      const resposta = await routeModule.POST(
        new NextRequest('http://localhost/api/webhooks/resend', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'svix-id': svixId,
            'svix-timestamp': svixTimestamp,
            'svix-signature': assinar(corpoCru, svixId, svixTimestamp),
          },
          body: corpoCru,
        })
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.ok).toBe(true);
    });
  });
});
