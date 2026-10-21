// T-130 (fase3-ingestao-continua): prova de AC-320 e AC-326 para
// `src/worker/index.ts`. Só o agendador e a parada graciosa são testados
// aqui com fakes — a leitura real das origens (Sheets/LP) já é provada nos
// próprios módulos de ETL e o isolamento de falhas/trava em T-128.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { criarManipuladorParada, iniciarAgendador } from '../../src/worker/index';

function criarDeferred<T = void>() {
  let resolve!: (valor: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('T-130: agendador e parada graciosa', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test(
    'os dois ciclos (representados pelo mesmo rodarCiclos) rodam a cada intervalo configurado, mais de uma vez quando o tempo passa (@spec:AC-320)',
    async () => {
      const chamadas: number[] = [];
      let contador = 0;
      const rodarCiclos = vi.fn(async () => {
        contador += 1;
        chamadas.push(contador);
      });

      const agendador = iniciarAgendador({ intervaloMs: 60_000, rodarCiclos });

      expect(rodarCiclos).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(rodarCiclos).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(rodarCiclos).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(120_000);
      expect(rodarCiclos).toHaveBeenCalledTimes(4);

      await agendador.pararEEsperar();
    }
  );

  test(
    'depois de parado, nenhum ciclo novo começa mesmo que o tempo continue passando (@spec:AC-320)',
    async () => {
      const rodarCiclos = vi.fn(async () => {});
      const agendador = iniciarAgendador({ intervaloMs: 1_000, rodarCiclos });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(rodarCiclos).toHaveBeenCalledTimes(1);

      await agendador.pararEEsperar();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(rodarCiclos).toHaveBeenCalledTimes(1);
    }
  );

  test(
    'o manipulador de SIGTERM espera o ciclo em andamento terminar antes de sair com código 0 (@spec:AC-326)',
    async () => {
      const deferred = criarDeferred<void>();
      let cicloTerminou = false;
      const rodarCiclos = vi.fn(async () => {
        await deferred.promise;
        cicloTerminou = true;
      });

      const agendador = iniciarAgendador({ intervaloMs: 1_000, rodarCiclos });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(rodarCiclos).toHaveBeenCalledTimes(1);

      const sair = vi.fn();
      const pararComGraca = criarManipuladorParada(agendador, sair);

      const paradaConcluida = pararComGraca();

      // O ciclo ainda está em andamento — nem terminou nem saiu ainda.
      await Promise.resolve();
      await Promise.resolve();
      expect(cicloTerminou).toBe(false);
      expect(sair).not.toHaveBeenCalled();

      // Nenhum ciclo novo começa enquanto se espera o ciclo em andamento
      // (o intervalo já foi limpo por `pararEEsperar`).
      await vi.advanceTimersByTimeAsync(10_000);
      expect(rodarCiclos).toHaveBeenCalledTimes(1);

      deferred.resolve();
      await paradaConcluida;

      expect(cicloTerminou).toBe(true);
      expect(sair).toHaveBeenCalledTimes(1);
      expect(sair).toHaveBeenCalledWith(0);
    }
  );
});
