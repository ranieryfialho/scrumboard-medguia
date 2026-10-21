// T-127 (fase3-ingestao-continua): prova de AC-327 e AC-320 para
// `src/worker/config.ts`.
import { describe, expect, test } from 'vitest';

import {
  carregarConfiguracaoWorker,
  ErroConfiguracaoWorker,
  INTERVALO_IMPORT_MIN_PADRAO,
  VARIAVEIS_OBRIGATORIAS,
} from '../../src/worker/config';

const ENV_COMPLETO: Record<string, string> = {
  DATABASE_URL: 'postgres://user:senha@host:5432/db',
  SUPABASE_LP_URL: 'https://lp.example.com',
  SUPABASE_LP_SERVICE_KEY: 'chave-secreta-lp',
  GOOGLE_CLIENT_EMAIL: 'conta@servico.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
};

describe('carregarConfiguracaoWorker', () => {
  test('com todas as variáveis presentes, carrega a configuração sem lançar @spec:AC-327', () => {
    const config = carregarConfiguracaoWorker({ ...ENV_COMPLETO });
    expect(config.databaseUrl).toBe(ENV_COMPLETO.DATABASE_URL);
    expect(config.supabaseLpUrl).toBe(ENV_COMPLETO.SUPABASE_LP_URL);
    expect(config.supabaseLpServiceKey).toBe(ENV_COMPLETO.SUPABASE_LP_SERVICE_KEY);
    expect(config.googleClientEmail).toBe(ENV_COMPLETO.GOOGLE_CLIENT_EMAIL);
    expect(config.googlePrivateKey).toBe(ENV_COMPLETO.GOOGLE_PRIVATE_KEY);
  });

  test('com uma variável obrigatória ausente, para na hora listando só o NOME que falta @spec:AC-327', () => {
    const envIncompleto = { ...ENV_COMPLETO };
    delete (envIncompleto as Record<string, string | undefined>).SUPABASE_LP_SERVICE_KEY;

    let erroCapturado: unknown;
    try {
      carregarConfiguracaoWorker(envIncompleto);
    } catch (erro) {
      erroCapturado = erro;
    }

    expect(erroCapturado).toBeInstanceOf(ErroConfiguracaoWorker);
    const erro = erroCapturado as ErroConfiguracaoWorker;
    expect(erro.variaveisFaltando).toEqual(['SUPABASE_LP_SERVICE_KEY']);
  });

  test('com várias variáveis ausentes, lista todos os nomes faltando e nenhum valor da configuração @spec:AC-327', () => {
    const envVazio: Record<string, string | undefined> = {};

    let erroCapturado: unknown;
    try {
      carregarConfiguracaoWorker(envVazio);
    } catch (erro) {
      erroCapturado = erro;
    }

    expect(erroCapturado).toBeInstanceOf(ErroConfiguracaoWorker);
    const erro = erroCapturado as ErroConfiguracaoWorker;
    expect(erro.variaveisFaltando).toEqual([...VARIAVEIS_OBRIGATORIAS]);
    expect(erro.message).not.toContain('postgres://');
    expect(erro.message).not.toContain('chave-secreta-lp');
    for (const nome of VARIAVEIS_OBRIGATORIAS) {
      expect(erro.message).toContain(nome);
    }
  });

  test('uma variável obrigatória em branco também conta como faltando @spec:AC-327', () => {
    const envComBranco = { ...ENV_COMPLETO, GOOGLE_PRIVATE_KEY: '   ' };

    expect(() => carregarConfiguracaoWorker(envComBranco)).toThrow(ErroConfiguracaoWorker);
  });

  test('sem WORKER_INTERVALO_IMPORT_MIN, os dois ciclos usam o intervalo padrão de 5 min (ASM-108) @spec:AC-320', () => {
    const config = carregarConfiguracaoWorker({ ...ENV_COMPLETO });
    expect(config.intervaloImportacaoMin).toBe(INTERVALO_IMPORT_MIN_PADRAO);
  });

  test('com WORKER_INTERVALO_IMPORT_MIN configurado, os dois ciclos compartilham esse mesmo intervalo @spec:AC-320', () => {
    const config = carregarConfiguracaoWorker({ ...ENV_COMPLETO, WORKER_INTERVALO_IMPORT_MIN: '15' });
    expect(config.intervaloImportacaoMin).toBe(15);
  });

  test('com WORKER_INTERVALO_IMPORT_MIN inválido, cai no padrão em vez de travar a subida @spec:AC-320', () => {
    const config = carregarConfiguracaoWorker({ ...ENV_COMPLETO, WORKER_INTERVALO_IMPORT_MIN: 'não-é-numero' });
    expect(config.intervaloImportacaoMin).toBe(INTERVALO_IMPORT_MIN_PADRAO);
  });
});
