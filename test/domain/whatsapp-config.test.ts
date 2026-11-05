import { afterEach, describe, expect, test } from 'vitest';

import { validarCorpoConfig } from '../../src/domain/whatsapp/config';
import {
  buildConfig,
  createInstance,
  instanciaJaExiste,
  getInstanceStatus,
  setWebhook,
} from '../../src/lib/evolution-api';
import { subirEvolutionFalsa, type EvolutionFalsa } from '../support/evolution-falsa';

// US-049 — Salvar a configuração do WhatsApp
describe('validarCorpoConfig', () => {
  test('AC-174: corpo que não é objeto JSON é recusado @spec:AC-174', () => {
    expect(validarCorpoConfig('clinica-a')).toEqual({ ok: false, erro: 'REQUISICAO_INVALIDA' });
    expect(validarCorpoConfig(null)).toEqual({ ok: false, erro: 'REQUISICAO_INVALIDA' });
    expect(validarCorpoConfig(['clinica-a'])).toEqual({ ok: false, erro: 'REQUISICAO_INVALIDA' });
    expect(validarCorpoConfig(42)).toEqual({ ok: false, erro: 'REQUISICAO_INVALIDA' });
  });

  test('AC-174: algum valor não texto é recusado, mesmo com o nome de instância válido @spec:AC-174', () => {
    const resultado = validarCorpoConfig({
      evolution_instance_name: 'clinica-a',
      evolution_auto_msg_recontato: 123,
    });

    expect(resultado).toEqual({ ok: false, erro: 'REQUISICAO_INVALIDA' });
  });

  test('AC-174: nome de instância vazio é recusado @spec:AC-174', () => {
    const resultado = validarCorpoConfig({ evolution_instance_name: '' });
    expect(resultado).toEqual({ ok: false, erro: 'REQUISICAO_INVALIDA' });
  });

  test('AC-174: nome de instância com mais de 64 caracteres é recusado @spec:AC-174', () => {
    const resultado = validarCorpoConfig({ evolution_instance_name: 'a'.repeat(65) });
    expect(resultado).toEqual({ ok: false, erro: 'REQUISICAO_INVALIDA' });
  });

  test('AC-174: nome de instância com caractere fora de letras, números, - e _ é recusado @spec:AC-174', () => {
    expect(validarCorpoConfig({ evolution_instance_name: 'clinica a' })).toEqual({
      ok: false,
      erro: 'REQUISICAO_INVALIDA',
    });
    expect(validarCorpoConfig({ evolution_instance_name: 'clinica/a' })).toEqual({
      ok: false,
      erro: 'REQUISICAO_INVALIDA',
    });
    expect(validarCorpoConfig({ evolution_instance_name: 'clinica?a' })).toEqual({
      ok: false,
      erro: 'REQUISICAO_INVALIDA',
    });
  });

  test('AC-174: corpo válido devolve só as chaves permitidas @spec:AC-174', () => {
    const resultado = validarCorpoConfig({
      evolution_instance_name: 'clinica-a_1',
      evolution_auto_msg_recontato: 'Olá, tudo bem?',
      chave_qualquer: 'ignorado',
      empresa_id: 'outra-empresa',
    });

    expect(resultado).toEqual({
      ok: true,
      valores: {
        evolution_instance_name: 'clinica-a_1',
        evolution_auto_msg_recontato: 'Olá, tudo bem?',
      },
    });
  });

  test('AC-174: nome de instância no limite de 64 caracteres é aceito @spec:AC-174', () => {
    const nome = 'a'.repeat(64);
    const resultado = validarCorpoConfig({ evolution_instance_name: nome });
    expect(resultado).toEqual({ ok: true, valores: { evolution_instance_name: nome } });
  });
});

// US-051 — Conectar o WhatsApp lendo o QR code
describe('cliente Evolution — falha da Evolution', () => {
  let evolution: EvolutionFalsa | undefined;

  afterEach(async () => {
    await evolution?.fechar();
    evolution = undefined;
  });

  test('AC-177: Evolution fora do ar vira estado de erro em vez de quebrar @spec:AC-177', async () => {
    evolution = await subirEvolutionFalsa();
    const config = { url: evolution.url, apiKey: evolution.apiKey, instance: 'clinica-a' };
    await evolution.fechar();
    evolution = undefined;

    const status = await getInstanceStatus(config);

    expect(status.error).toBeDefined();
    expect(status.instance).toBeUndefined();
  });

  test('AC-177: Evolution respondendo erro HTTP vira estado de erro @spec:AC-177', async () => {
    evolution = await subirEvolutionFalsa();
    const config = { url: evolution.url, apiKey: evolution.apiKey, instance: 'clinica-a' };

    const original = globalThis.fetch;
    // Simula a Evolution respondendo um erro HTTP genérico no endpoint de estado
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0]);
      if (url.includes('/instance/connectionState/')) {
        return new Response('erro simulado', { status: 500 });
      }
      return original(...args);
    }) as typeof fetch;

    try {
      const status = await getInstanceStatus(config);
      expect(status.error).toBe('Erro 500');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('AC-185: falha ao registrar o webhook não lança erro, só devolve false @spec:AC-185', async () => {
    evolution = await subirEvolutionFalsa();
    evolution.definirComportamentoWebhook({ tipo: 'erro', status: 500 });
    const config = buildConfig('clinica-a');
    config.url = evolution.url;
    config.apiKey = evolution.apiKey;

    const registrado = await setWebhook(config, 'https://app.exemplo.com/api/whatsapp/webhook');

    expect(registrado).toBe(false);
    expect(evolution.chamadasWebhook).toHaveLength(1);
  });

  test('AC-185: webhook registrado com sucesso devolve true @spec:AC-185', async () => {
    evolution = await subirEvolutionFalsa();
    const config = buildConfig('clinica-a');
    config.url = evolution.url;
    config.apiKey = evolution.apiKey;

    const registrado = await setWebhook(config, 'https://app.exemplo.com/api/whatsapp/webhook');

    expect(registrado).toBe(true);
  });

  test('AC-186: falha ao criar a instância (erro diferente de "já existe") lança erro @spec:AC-186', async () => {
    evolution = await subirEvolutionFalsa();
    evolution.definirComportamentoCriarInstancia({ tipo: 'erro', status: 500 });
    const config = buildConfig('clinica-a');
    config.url = evolution.url;
    config.apiKey = evolution.apiKey;

    await expect(createInstance(config)).rejects.toThrow();
  });

  test('AC-186: instância já existente (409 da Evolution) não lança erro @spec:AC-186', async () => {
    evolution = await subirEvolutionFalsa();
    evolution.definirComportamentoCriarInstancia({ tipo: 'ja_existe' });
    const config = buildConfig('clinica-a');
    config.url = evolution.url;
    config.apiKey = evolution.apiKey;

    await expect(createInstance(config)).resolves.toBeUndefined();
  });

  test('"já existe" vale para o 409 e para o 403 "already in use" da Evolution v2; outros erros não @spec:AC-186', () => {
    expect(instanciaJaExiste(409, '')).toBe(true);
    expect(instanciaJaExiste(403, '{"response":{"message":["This name \\"medguiacomercial\\" is already in use."]}}')).toBe(true);
    expect(instanciaJaExiste(403, '{"message":"Forbidden"}')).toBe(false);
    expect(instanciaJaExiste(500, 'already in use')).toBe(false);
  });
});
