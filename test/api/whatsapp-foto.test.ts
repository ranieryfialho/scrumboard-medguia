// GET /api/whatsapp/foto — foto de perfil do contato servida pelo CRM. Postgres efêmero real (instância da empresa); sessão, Evolution e o
// download da imagem são simulados. O volume de fotos é uma pasta temporária.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const COM_INSTANCIA = 'e0000000-0000-0000-0000-000000000031';
const SEM_INSTANCIA = 'e0000000-0000-0000-0000-000000000032';
const LEAD_COM = 'e0000000-0000-0000-0000-00000000d001';
const LEAD_DE_OUTRA = 'e0000000-0000-0000-0000-00000000d002';
const URL_FOTO = 'https://pps.whatsapp.net/v/t61/foto.jpg?oh=x';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);

const sim = vi.hoisted(() => ({
  empresa: 'e0000000-0000-0000-0000-000000000031',
  urls: {} as Record<string, string | null>,
  consultados: [] as string[],
}));

vi.mock('../../src/lib/auth/instancia', () => ({
  getAuth: () => ({
    api: { getSession: async ({ headers }: { headers: Headers }) => (headers.get('x-sessao') ? { session: { token: 'tok' } } : null) },
  }),
}));
vi.mock('../../src/lib/auth/tenant', async (importarOriginal) => {
  const original = await importarOriginal<typeof import('../../src/lib/auth/tenant')>();
  return { ...original, resolverContextoTenant: async () => ({ usuarioId: 'u', empresaId: sim.empresa, papel: 'MASTER', isSuperAdmin: false }) };
});
vi.mock('../../src/lib/evolution-api', async (importarOriginal) => {
  const original = await importarOriginal<typeof import('../../src/lib/evolution-api')>();
  return {
    ...original,
    fetchProfilePictureUrl: async (_config: unknown, numero: string) => {
      sim.consultados.push(numero);
      return sim.urls[numero] ?? null;
    },
  };
});

describe('GET /api/whatsapp/foto', () => {
  let pg: PostgresEfemero;
  let rota: typeof import('../../src/app/api/whatsapp/foto/route');
  let volume: string;
  const ANEXOS_ORIGINAL = process.env.ANEXOS_DIR;

  beforeAll(async () => {
    volume = await mkdtemp(path.join(tmpdir(), 'rota-foto-'));
    process.env.ANEXOS_DIR = volume;
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${COM_INSTANCIA}', 'Com Instancia', 'com-instancia-foto'),
         ('${SEM_INSTANCIA}', 'Sem Instancia', 'sem-instancia-foto');
       INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor") VALUES
         ('${COM_INSTANCIA}', 'evolution_instance_name', '"instancia-foto"'::jsonb);
       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES
         ('${LEAD_COM}', '${COM_INSTANCIA}', 'Lead Com', '+5585999985587'),
         ('${LEAD_DE_OUTRA}', '${SEM_INSTANCIA}', 'Lead Outra', '+5511987654321');`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);
    process.env.DATABASE_URL = pg.appUrl;
    rota = await import('../../src/app/api/whatsapp/foto/route');
  }, 120_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    const { getDb } = await import('../../src/db/client');
    await (getDb() as unknown as { $client: Pool }).$client.end();
    pg?.parar();
    process.env.ANEXOS_DIR = ANEXOS_ORIGINAL;
    await rm(volume, { recursive: true, force: true });
  });

  beforeEach(async () => {
    sim.empresa = COM_INSTANCIA;
    sim.urls = {};
    sim.consultados = [];
    await rm(path.join(volume, 'whatsapp-fotos'), { recursive: true, force: true });
    // o download da imagem (só hosts do WhatsApp chegam aqui)
    vi.stubGlobal('fetch', async () => new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
  });

  const get = (numero: string | null, sessao = true) =>
    rota.GET(new NextRequest(`http://localhost/api/whatsapp/foto${numero === null ? '' : `?numero=${numero}`}`, { headers: sessao ? { 'x-sessao': '1' } : {} }));
  const getDoLead = (leadId: string) =>
    rota.GET(new NextRequest(`http://localhost/api/whatsapp/foto?leadId=${leadId}`, { headers: { 'x-sessao': '1' } }));

  test('sem sessão: 401 e a Evolution nem é consultada', async () => {
    expect((await get('5585999985587', false)).status).toBe(401);
    expect(sim.consultados).toEqual([]);
  });

  test('número ausente ou inválido: 400', async () => {
    expect((await get(null)).status).toBe(400);
    expect((await get('abc')).status).toBe(400);
    expect(sim.consultados).toEqual([]);
  });

  test('empresa sem instância do WhatsApp: 404', async () => {
    sim.empresa = SEM_INSTANCIA;
    expect((await get('5585999985587')).status).toBe(404);
    expect(sim.consultados).toEqual([]);
  });

  test('contato com foto: 200, image/jpeg, cache privado e os bytes da imagem', async () => {
    sim.urls['5585999985587'] = URL_FOTO;
    const r = await get('5585999985587');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    expect(r.headers.get('cache-control')).toContain('private');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await r.arrayBuffer())).toEqual(JPEG);
  });

  test('segunda abertura sai do cache: a Evolution não é consultada de novo', async () => {
    sim.urls['5585999985587'] = URL_FOTO;
    await get('5585999985587');
    const consultasAntes = sim.consultados.length;
    expect((await get('5585999985587')).status).toBe(200);
    expect(sim.consultados.length).toBe(consultasAntes);
  });

  test('sem foto (privacidade): 404 SEM_FOTO; e lembra, sem insistir na Evolution', async () => {
    const r = await get('5585999985587');
    expect(r.status).toBe(404);
    expect((await r.json()).codigo).toBe('SEM_FOTO');
    const consultasAntes = sim.consultados.length;
    expect((await get('5585999985587')).status).toBe(404);
    expect(sim.consultados.length).toBe(consultasAntes);
  });

  test('número gravado sem o nono dígito: tenta também a outra grafia até achar a foto', async () => {
    sim.urls['558599985587'] = URL_FOTO; // só a grafia sem o 9 tem foto
    const r = await get('5585999985587');
    expect(r.status).toBe(200);
    expect(sim.consultados).toContain('558599985587');
  });

  test('por leadId: acha o telefone do lead no servidor e devolve a foto', async () => {
    sim.urls['5585999985587'] = URL_FOTO;
    const r = await getDoLead(LEAD_COM);
    expect(r.status).toBe(200);
    expect(Buffer.from(await r.arrayBuffer())).toEqual(JPEG);
    expect(sim.consultados).toContain('5585999985587');
  });

  test('por leadId: lead de outra empresa ou inexistente dá "sem foto" e a Evolution não é consultada', async () => {
    for (const leadId of [LEAD_DE_OUTRA, 'ffffffff-ffff-ffff-ffff-ffffffffffff']) {
      const r = await getDoLead(leadId);
      expect(r.status).toBe(404);
      expect((await r.json()).codigo).toBe('SEM_FOTO');
    }
    expect(sim.consultados).toEqual([]);
  });

  test('por leadId: id que não é uuid é 400', async () => {
    expect((await getDoLead('nao-e-uuid')).status).toBe(400);
  });

  test('a mesma pessoa em outra empresa não enxerga a foto em cache da primeira', async () => {
    sim.urls['5585999985587'] = URL_FOTO;
    await get('5585999985587');
    sim.empresa = SEM_INSTANCIA; // outra empresa (sem instância) não acessa nem o cache
    expect((await get('5585999985587')).status).toBe(404);
  });
});
