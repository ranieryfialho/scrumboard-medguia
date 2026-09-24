// Testes de T-010 (fase1-schema-drizzle, US-007): instalação e configuração
// do Drizzle ORM + drizzle-kit.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const packageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
);

describe('T-010: dependências instaladas', () => {
  test('drizzle-orm e pg estão em dependencies', () => {
    expect(packageJson.dependencies).toHaveProperty('drizzle-orm');
    expect(packageJson.dependencies).toHaveProperty('pg');
  });

  test('drizzle-kit e @types/pg estão em devDependencies', () => {
    expect(packageJson.devDependencies).toHaveProperty('drizzle-kit');
    expect(packageJson.devDependencies).toHaveProperty('@types/pg');
  });

  test('scripts db:generate e db:migrate usam drizzle-kit', () => {
    expect(packageJson.scripts['db:generate']).toContain('drizzle-kit');
    expect(packageJson.scripts['db:migrate']).toContain('drizzle-kit');
  });

  test('package-lock.json referencia drizzle-orm, drizzle-kit e pg', () => {
    const lock = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8')
    );
    const rootDeps = lock.packages?.[''] ?? {};
    const allDeclared = {
      ...(rootDeps.dependencies ?? {}),
      ...(rootDeps.devDependencies ?? {}),
    };
    expect(allDeclared).toHaveProperty('drizzle-orm');
    expect(allDeclared).toHaveProperty('drizzle-kit');
    expect(allDeclared).toHaveProperty('pg');
    expect(allDeclared).toHaveProperty('@types/pg');
  });
});

describe('T-010: drizzle.config.ts', () => {
  const configSource = fs.readFileSync(
    path.join(process.cwd(), 'drizzle.config.ts'),
    'utf8'
  );

  test('usa dialect postgresql e diretório de saída ./drizzle', () => {
    expect(configSource).toMatch(/dialect:\s*['"]postgresql['"]/);
    expect(configSource).toMatch(/out:\s*['"]\.\/drizzle['"]/);
  });

  test('valida DATABASE_URL antes de montar a config', () => {
    expect(configSource).toMatch(/DATABASE_URL/);
    expect(configSource).toMatch(/throw new Error/);
  });

  test('carrega com sucesso quando DATABASE_URL está definida', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://crm_migrator:x@localhost:5432/crm_test';
    try {
      const mod = await import('../../drizzle.config');
      const config = mod.default;
      expect(config.dialect).toBe('postgresql');
      expect(config.out).toBe('./drizzle');
      const credentials = 'dbCredentials' in config ? config.dbCredentials : undefined;
      if (!credentials || !('url' in credentials)) {
        throw new Error('config.dbCredentials.url ausente');
      }
      expect(credentials.url).toBe(process.env.DATABASE_URL);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});

describe('T-010: src/db/client.ts', () => {
  let createDbClient: typeof import('../../src/db/client').createDbClient;
  let getDb: typeof import('../../src/db/client').getDb;

  const previousEnv: { value?: string } = {};

  beforeEach(async () => {
    const mod = await import('../../src/db/client');
    createDbClient = mod.createDbClient;
    getDb = mod.getDb;
    previousEnv.value = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (previousEnv.value === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousEnv.value;
  });

  test('createDbClient lança erro sem DATABASE_URL', () => {
    expect(() => createDbClient(undefined)).toThrow(/DATABASE_URL/);
  });

  test('createDbClient retorna um client drizzle quando a URL é informada', () => {
    const client = createDbClient('postgres://crm_app:x@localhost:5432/crm_test');
    expect(client).toBeDefined();
    expect(typeof client.select).toBe('function');
  });

  test('getDb usa process.env.DATABASE_URL e lança se ausente', () => {
    expect(() => getDb()).toThrow(/DATABASE_URL/);
  });

  test('getDb memoiza a instância entre chamadas', () => {
    process.env.DATABASE_URL = 'postgres://crm_app:x@localhost:5432/crm_test';
    const first = getDb();
    const second = getDb();
    expect(first).toBe(second);
  });
});
