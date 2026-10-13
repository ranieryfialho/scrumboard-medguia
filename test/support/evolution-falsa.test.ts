// T-082 fase2c-whatsapp-conexao: prova que o servidor HTTP falso da
// Evolution cobre os quatro endpoints de conexão (criar instância, registrar
// webhook, conectar e consultar estado) que a futura rota de QR code (T-087)
// vai exercitar via `src/lib/evolution-api.ts`. Os testes chamam o servidor
// falso diretamente, como um cliente HTTP genérico chamaria, sem depender da
// rota ainda não implementada.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { subirEvolutionFalsa, type EvolutionFalsa } from './evolution-falsa';

describe('evolution-falsa: endpoints de conexão', () => {
  let evolution: EvolutionFalsa;

  beforeEach(async () => {
    evolution = await subirEvolutionFalsa();
  });

  afterEach(async () => {
    await evolution.fechar();
  });

  it('@spec:AC-176 consulta de estado devolve o que a Evolution falsa informar para a instância da empresa', async () => {
    evolution.definirComportamentoEstado({ tipo: 'estado', state: 'open' });

    const res = await fetch(`${evolution.url}/instance/connectionState/clinica-a`, {
      headers: { apikey: evolution.apiKey },
    });
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.instance.state).toBe('open');
    expect(evolution.chamadasEstado).toEqual([{ instance: 'clinica-a' }]);
  });

  it('@spec:AC-180 cria a instância, registra o webhook e só então conecta, nessa ordem', async () => {
    const instance = 'clinica-b';

    const criar = await fetch(`${evolution.url}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evolution.apiKey },
      body: JSON.stringify({ instanceName: instance, integration: 'WHATSAPP-BAILEYS', qrcode: true }),
    });
    expect(criar.status).toBe(201);

    const webhookUrl = 'https://app.exemplo/api/whatsapp/webhook?empresa_id=empresa-b&secret=segredo-b';
    const webhook = await fetch(`${evolution.url}/webhook/set/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evolution.apiKey },
      body: JSON.stringify({
        webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT'] },
      }),
    });
    expect(webhook.status).toBe(201);

    const conectar = await fetch(`${evolution.url}/instance/connect/${instance}`, {
      headers: { apikey: evolution.apiKey },
    });
    const corpoConectar = await conectar.json();

    expect(conectar.status).toBe(200);
    expect(typeof corpoConectar.base64).toBe('string');

    expect(evolution.ordemChamadas).toEqual([
      `criar:${instance}`,
      `webhook:${instance}`,
      `conectar:${instance}`,
    ]);
    expect(evolution.chamadasWebhook[0].instance).toBe(instance);
    expect((evolution.chamadasWebhook[0].corpo as { webhook: { url: string } }).webhook.url).toBe(webhookUrl);
  });

  it('@spec:AC-184 instância já conectada responde "open" ao pedir o QR code, sem base64', async () => {
    evolution.definirComportamentoConectar({ tipo: 'aberto' });

    const res = await fetch(`${evolution.url}/instance/connect/clinica-c`, {
      headers: { apikey: evolution.apiKey },
    });
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.instance.state).toBe('open');
    expect(corpo.base64).toBeUndefined();
  });

  it('@spec:AC-185 falha ao registrar o webhook não impede consultar o QR code depois', async () => {
    const instance = 'clinica-d';

    const criar = await fetch(`${evolution.url}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evolution.apiKey },
      body: JSON.stringify({ instanceName: instance, integration: 'WHATSAPP-BAILEYS', qrcode: true }),
    });
    expect(criar.status).toBe(201);

    evolution.definirComportamentoWebhook({ tipo: 'erro', status: 500 });
    const webhook = await fetch(`${evolution.url}/webhook/set/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evolution.apiKey },
      body: JSON.stringify({ webhook: { enabled: true, url: 'https://app.exemplo/webhook' } }),
    });
    expect(webhook.status).toBe(500);

    const conectar = await fetch(`${evolution.url}/instance/connect/${instance}`, {
      headers: { apikey: evolution.apiKey },
    });
    const corpoConectar = await conectar.json();

    expect(conectar.status).toBe(200);
    expect(typeof corpoConectar.base64).toBe('string');
    expect(evolution.chamadasConectar).toEqual([{ instance }]);
  });

  it('@spec:AC-186 falha ao criar a instância (erro diferente de já existir) é devolvida como erro', async () => {
    evolution.definirComportamentoCriarInstancia({ tipo: 'erro', status: 500 });

    const criar = await fetch(`${evolution.url}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evolution.apiKey },
      body: JSON.stringify({ instanceName: 'clinica-e', integration: 'WHATSAPP-BAILEYS', qrcode: true }),
    });

    expect(criar.status).toBe(500);
    expect(evolution.chamadasWebhook).toEqual([]);
    expect(evolution.chamadasConectar).toEqual([]);
  });

  it('@spec:AC-186 instância que já existia (409 da Evolution) segue o fluxo normal', async () => {
    evolution.definirComportamentoCriarInstancia({ tipo: 'ja_existe' });

    const criar = await fetch(`${evolution.url}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evolution.apiKey },
      body: JSON.stringify({ instanceName: 'clinica-f', integration: 'WHATSAPP-BAILEYS', qrcode: true }),
    });

    expect(criar.status).toBe(409);
  });
});
