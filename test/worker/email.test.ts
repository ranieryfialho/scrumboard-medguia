// T-269 (fase5-email-disparo, AC-708): o ponto de entrada do `crm-worker-email` — configuração mínima, um ciclo a cada 10 s
// sem sobreposição, ciclo que falha não derruba o processo e parada graciosa. Sem banco e sem rede (fakes).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { INTERVALO_DO_CICLO_MS } from '../../src/lib/email/disparo-worker';
import { ErroConfiguracaoWorker } from '../../src/worker/config';
import { carregarConfiguracaoWorkerEmail, iniciarAgendadorDeEmail } from '../../src/worker/email';

function adiavel<T = void>() {
  let resolve!: (valor: T) => void;
  const promessa = new Promise<T>((r) => {
    resolve = r;
  });
  return { promessa, resolve };
}

describe('T-269: worker de e-mail (ponto de entrada)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('só exige DATABASE_URL e SEGREDO_CONFIGURACOES, e o erro traz os nomes, nunca os valores @spec:AC-708', () => {
    expect(carregarConfiguracaoWorkerEmail({ DATABASE_URL: 'postgres://x', SEGREDO_CONFIGURACOES: 'um-segredo-de-teste' })).toEqual({ databaseUrl: 'postgres://x' });

    let erro: unknown;
    try {
      carregarConfiguracaoWorkerEmail({ DATABASE_URL: 'postgres://segredo@host/db', SEGREDO_CONFIGURACOES: '  ' });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroConfiguracaoWorker);
    expect((erro as ErroConfiguracaoWorker).variaveisFaltando).toEqual(['SEGREDO_CONFIGURACOES']);
    expect((erro as Error).message).not.toContain('postgres://');

    // as variáveis do Sheets e da LP não entram nesta exigência
    expect(() => carregarConfiguracaoWorkerEmail({ DATABASE_URL: 'postgres://x', SEGREDO_CONFIGURACOES: 'um-segredo-de-teste' })).not.toThrow();
  });

  test('roda um ciclo a cada 10 s e nunca dois ao mesmo tempo @spec:AC-708', async () => {
    expect(INTERVALO_DO_CICLO_MS).toBe(10_000);
    const lento = adiavel();
    const rodarCiclo = vi.fn(() => lento.promessa);
    const agendador = iniciarAgendadorDeEmail({ rodarCiclo });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(rodarCiclo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(rodarCiclo).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000); // o ciclo ainda não terminou: nenhum outro começa
    expect(rodarCiclo).toHaveBeenCalledTimes(1);

    lento.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rodarCiclo).toHaveBeenCalledTimes(2);
    await agendador.pararEEsperar();
  });

  test('um ciclo que falha não derruba o processo nem impede o próximo @spec:AC-708', async () => {
    const aoFalhar = vi.fn();
    const rodarCiclo = vi.fn().mockRejectedValueOnce(new Error('banco fora do ar')).mockResolvedValue(undefined);
    const agendador = iniciarAgendadorDeEmail({ rodarCiclo, aoFalhar });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(aoFalhar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rodarCiclo).toHaveBeenCalledTimes(2);
    await agendador.pararEEsperar();
  });

  test('ao parar (SIGTERM), termina o ciclo em curso antes de sair e não começa outro @spec:AC-708', async () => {
    const emCurso = adiavel();
    const rodarCiclo = vi.fn(() => emCurso.promessa);
    const agendador = iniciarAgendadorDeEmail({ rodarCiclo });
    await vi.advanceTimersByTimeAsync(10_000);

    let terminou = false;
    const parada = agendador.pararEEsperar().then(() => {
      terminou = true;
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(terminou).toBe(false); // espera o ciclo em curso
    expect(rodarCiclo).toHaveBeenCalledTimes(1); // e nenhum ciclo novo começou

    emCurso.resolve();
    await parada;
    expect(terminou).toBe(true);
  });

  test('o comando npm run worker:email e o serviço crm-worker-email existem @spec:AC-708', () => {
    const pacote = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(pacote.scripts['worker:email']).toBe('tsx src/worker/email.ts');
    const compose = readFileSync('docker-compose.yml', 'utf8');
    expect(compose).toMatch(/crm-worker-email:\n(?:.*\n)*?\s+command: \["npm", "run", "worker:email"\]/);
  });
});
