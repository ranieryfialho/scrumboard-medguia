// T-282 (fase3-ingestao-continua, US-093, AC-731): a LP é opcional no worker. Sem as variáveis dela, o worker sobe e roda só o
// ciclo do Sheets; só uma das duas é erro de configuração. Sem banco e sem rede (os ciclos são montados mas não executados).
import { describe, expect, test } from 'vitest';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { carregarConfiguracaoWorker, ErroConfiguracaoWorker, lpHabilitada } from '../../src/worker/config';
import { construirCiclosOrigem } from '../../src/worker/index';

const SO_SHEETS: Record<string, string> = {
  DATABASE_URL: 'postgres://usuario:segredo@host/db',
  GOOGLE_CLIENT_EMAIL: 'conta@projeto.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: 'chave-privada',
};
const COM_LP = { ...SO_SHEETS, SUPABASE_LP_URL: 'https://lp.example.com', SUPABASE_LP_SERVICE_KEY: 'chave-lp' };
const banco = {} as NodePgDatabase;

describe('T-282: a LP é opcional no worker', () => {
  test('sem as variáveis da LP, a configuração carrega e a LP fica desligada (@spec:AC-731)', () => {
    const config = carregarConfiguracaoWorker(SO_SHEETS);
    expect(config.supabaseLpUrl).toBeUndefined();
    expect(config.supabaseLpServiceKey).toBeUndefined();
    expect(lpHabilitada(config)).toBe(false);
  });

  test('com as duas variáveis da LP, ela fica ligada (@spec:AC-731)', () => {
    expect(lpHabilitada(carregarConfiguracaoWorker(COM_LP))).toBe(true);
  });

  test('só uma das duas variáveis da LP é recusada, listando o nome da que falta e nenhum valor (@spec:AC-731)', () => {
    const soUrl = { ...SO_SHEETS, SUPABASE_LP_URL: 'https://lp.example.com' };
    let erro: unknown;
    try {
      carregarConfiguracaoWorker(soUrl);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroConfiguracaoWorker);
    expect((erro as ErroConfiguracaoWorker).variaveisFaltando).toEqual(['SUPABASE_LP_SERVICE_KEY']);
    expect((erro as Error).message).not.toContain('lp.example.com');
  });

  test('os ciclos montados são só o do Sheets sem a LP, e os dois com ela (@spec:AC-731)', () => {
    const semLp = construirCiclosOrigem(banco, carregarConfiguracaoWorker(SO_SHEETS), {});
    expect(semLp.map((c) => c.job)).toEqual(['import-sheets']);
    const comLp = construirCiclosOrigem(banco, carregarConfiguracaoWorker(COM_LP), {});
    expect(comLp.map((c) => c.job)).toEqual(['import-sheets', 'import-lp']);
  });
});
