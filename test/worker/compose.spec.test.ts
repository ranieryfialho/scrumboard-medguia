// T-131 (fase3-ingestao-continua): prova de AC-328 — o serviço `crm-worker`
// existe na composição, usa a imagem de worker da aplicação (não a do site) com outro comando
// de entrada, e tem o healthcheck de saúde (AC-323, src/worker/saude.ts).
import fs from 'node:fs';
import path from 'node:path';

import { load as yamlLoad } from 'js-yaml';
import { describe, expect, test } from 'vitest';

interface ServicoCompose {
  image?: string;
  command?: string[] | string;
  env_file?: string[] | string;
  healthcheck?: {
    test?: string[];
    interval?: string;
    timeout?: string;
    retries?: number;
  };
}

interface ArquivoCompose {
  services: Record<string, ServicoCompose>;
}

function carregarCompose(nomeArquivo: string): ArquivoCompose {
  const caminho = path.join(process.cwd(), nomeArquivo);
  return yamlLoad(fs.readFileSync(caminho, 'utf8')) as ArquivoCompose;
}

function esperarHealthcheckDeAc323(healthcheck: ServicoCompose['healthcheck']): void {
  expect(healthcheck, 'serviço do worker precisa ter healthcheck (AC-323)').toBeDefined();
  expect(healthcheck?.test, 'healthcheck.test precisa existir').toBeDefined();

  const comando = (healthcheck?.test ?? []).join(' ');
  expect(comando).toContain('verificarSaudeWorker');
  expect(comando).toContain('import-sheets');
  expect(comando).toContain('import-lp');
}

describe('T-131: serviço crm-worker na composição', () => {
  test('docker-compose.yml define o serviço crm-worker com a imagem de worker (não a do site), outro comando e o healthcheck de saúde (@spec:AC-328)', () => {
    const compose = carregarCompose('docker-compose.yml');
    const app = compose.services['scrumboard-medguia'];
    const worker = compose.services['crm-worker'];

    expect(app, 'docker-compose.yml precisa definir o serviço scrumboard-medguia').toBeDefined();
    expect(worker, 'docker-compose.yml precisa definir o serviço crm-worker').toBeDefined();

    expect(worker.image).toMatch(/scrumboard-medguia-worker:/);
    expect(worker.image).not.toBe(app.image);
    expect(worker.command).toBeDefined();
    expect(worker.command).not.toEqual(app.command);

    esperarHealthcheckDeAc323(worker.healthcheck);
  });

  test('docker-compose.staging.yml define o serviço do worker de staging com a imagem de worker (não a do site), outro comando e o healthcheck de saúde (@spec:AC-328)', () => {
    const compose = carregarCompose('docker-compose.staging.yml');
    const app = compose.services['crm-app-staging'];
    const worker = compose.services['crm-worker-staging'];

    expect(app, 'docker-compose.staging.yml precisa definir o serviço crm-app-staging').toBeDefined();
    expect(worker, 'docker-compose.staging.yml precisa definir o serviço do worker de staging').toBeDefined();

    expect(worker.image).toMatch(/scrumboard-medguia-worker:/);
    expect(worker.image).not.toBe(app.image);
    expect(worker.command).toBeDefined();
    expect(worker.command).not.toEqual(app.command);

    esperarHealthcheckDeAc323(worker.healthcheck);
  });
});
