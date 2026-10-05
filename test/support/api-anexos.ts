// Fixture compartilhada pelos testes de rota de anexos (fase2c-anexos): sobe
// um Postgres efêmero com dois tenants, um gerente logado em cada um, um
// volume temporário (ANEXOS_DIR) e o segredo de assinatura.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from './postgres-efemero';
import { seedarDoisTenants, type TenantsSeedados } from './seed-tenants';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';

export interface AmbienteAnexos {
  pg: PostgresEfemero;
  db: NodePgDatabase;
  tenants: TenantsSeedados;
  volume: string;
  cookieA: string;
  cookieB: string;
  parar(): Promise<void>;
}

async function loginComoCookie(auth: Auth, email: string): Promise<string> {
  const resposta = await auth.api.signInEmail({
    body: { email, password: SENHA },
    asResponse: true,
  });
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!sessionCookie) {
    throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
  }
  return sessionCookie.split(';')[0];
}

/** `cartoesA`: cards extras da empresa A (id e etapa) inseridos além do seedado. */
export async function prepararAmbienteAnexos(
  cartoesA: { id: string; etapaId: number }[] = []
): Promise<AmbienteAnexos> {
  const pg = await subirPostgresEfemero();
  pg.aplicarMigrations();
  const tenants = seedarDoisTenants(pg);

  if (cartoesA.length > 0) {
    const valores = cartoesA
      .map((c) => `('${c.id}', '${tenants.empresaA}', '${tenants.leadA}', ${c.etapaId})`)
      .join(',\n');
    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ${valores};`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar cards de anexos: ${setup.stderr}`);
  }

  const volume = await mkdtemp(path.join(os.tmpdir(), 'anexos-rota-'));
  process.env.ANEXOS_DIR = volume;
  process.env.ANEXOS_SEGREDO = 'segredo-de-teste-anexos';

  const pool = new Pool({ connectionString: pg.appUrl });
  const db = drizzle(pool);
  const auth = criarAuth(db);

  const atorA: AtorConvite = {
    usuarioId: 'ffffffff-0000-0000-0000-0000000000f1',
    empresaId: tenants.empresaA,
    papel: 'MASTER',
    isSuperAdmin: false,
  };
  const atorB: AtorConvite = {
    ...atorA,
    usuarioId: 'ffffffff-0000-0000-0000-0000000000f2',
    empresaId: tenants.empresaB,
  };

  const conviteA = await convidarUsuario(db, atorA, { email: 'gerente.a@teste.com', papel: 'GERENTE' });
  await definirSenhaComToken(db, conviteA.token, SENHA);
  const conviteB = await convidarUsuario(db, atorB, { email: 'gerente.b@teste.com', papel: 'GERENTE' });
  await definirSenhaComToken(db, conviteB.token, SENHA);

  process.env.DATABASE_URL = pg.appUrl;
  const cookieA = await loginComoCookie(auth, 'gerente.a@teste.com');
  const cookieB = await loginComoCookie(auth, 'gerente.b@teste.com');

  return {
    pg,
    db,
    tenants,
    volume,
    cookieA,
    cookieB,
    async parar() {
      const { getDb } = await import('../../src/db/client');
      const dbInterno = getDb() as unknown as { $client: Pool };
      await dbInterno.$client.end();
      await pool.end();
      pg.parar();
      await rm(volume, { recursive: true, force: true });
    },
  };
}

export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const PDF_CABECALHO = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

/** Conteúdo com o cabeçalho dado, preenchido com zeros até `tamanho` bytes. */
export function preencher(cabecalho: Uint8Array, tamanho: number): Uint8Array {
  const bytes = new Uint8Array(tamanho);
  bytes.set(cabecalho.subarray(0, Math.min(cabecalho.length, tamanho)));
  return bytes;
}
