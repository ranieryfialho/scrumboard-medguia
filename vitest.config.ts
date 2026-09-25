import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Só os componentes React (test/components/**) importam via `@/...`
    // (convenção do Next.js) — o resto do projeto usa import relativo.
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    include: ['test/**/*.test.*', 'tests/**/*.test.*', 'src/**/*.{test,spec}.*'],
    environment: 'node',
    // T-050 (fase2-kanban): os testes de componente (AC-089/AC-090, cliques
    // reais no modal) precisam de DOM — todo o resto (repositórios, rotas
    // via handler direto, domínio puro) roda em `node` puro, sem jsdom.
    environmentMatchGlobs: [['test/components/**', 'jsdom']],
    testTimeout: 30000,
    // beforeAll de test/fase0-fundacao-ci-staging.spec.test.js sobe um
    // container Postgres e espera até READY_TIMEOUT_MS (90s) ele inicializar;
    // sem isso, o hookTimeout default do Vitest (10s) aborta o hook antes do
    // container terminar de subir no runner do CI.
    hookTimeout: 100000,
    // Vários arquivos de test/db/*.test.ts sobem, cada um, seu próprio
    // Postgres efêmero via `docker run` (T-020). Rodando em paralelo (default
    // do Vitest), os containers concorrem por recursos do Docker e um deles
    // pode ser derrubado a meio de uma migration ("database system is
    // shutting down") — falso negativo. Arquivos em série evita isso, tanto
    // localmente quanto no runner do CI.
    fileParallelism: false,
  },
});
