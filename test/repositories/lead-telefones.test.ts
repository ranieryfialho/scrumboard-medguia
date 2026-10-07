// Testes de T-073 (fase2c-whatsapp-conversa): repositório dos telefones do
// lead contra um Postgres 15 efêmero real com dois tenants seedados.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { seedarDoisTenants, type TenantsSeedados } from '../support/seed-tenants';
import {
  criarTelefoneLead,
  ErroLeadNaoEncontrado,
  ErroTelefoneDuplicado,
  listarTelefonesLead,
  removerTelefoneLead,
} from '../../src/repositories/lead-telefones';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const USUARIO_A = 'aaaaaaaa-0000-0000-0000-0000000000d1';
// Lead da empresa A com telefone principal `+5585999985587` (AC-161) e um
// extra já cadastrado `5585988887777` direto por SQL (fora do repositório,
// como uma fixture de "estado já existente").
const LEAD_COM_TELEFONES = 'dddddddd-0000-0000-0000-0000000000a1';
const EXTRA_JA_CADASTRADO = 'dddddddd-0000-0000-0000-0000000000a2';

function contextoDe(empresaId: string, usuarioId = USUARIO_A): ContextoTenant {
  return { usuarioId, empresaId, papel: 'GERENTE', isSuperAdmin: false };
}

describe('T-073: repositório de telefones do lead', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let tenants: TenantsSeedados;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    const extras = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${USUARIO_A}', 'telefones.a@teste.com', 'Usuária A');
       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164")
         VALUES ('${LEAD_COM_TELEFONES}', '${tenants.empresaA}', 'Lead com telefones', '+5585999985587');
       INSERT INTO "lead_telefones" ("id", "empresa_id", "lead_id", "numero", "rotulo")
         VALUES ('${EXTRA_JA_CADASTRADO}', '${tenants.empresaA}', '${LEAD_COM_TELEFONES}', '5585988887777', 'Sócio');`
    );
    if (extras.status !== 0) throw new Error(`Falha ao preparar fixtures de lead-telefones: ${extras.stderr}`);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  test('cadastra telefone extra com DDI 55, dígitos só, rótulo e id @spec:AC-160', async () => {
    const telefone = await criarTelefoneLead(db, contextoDe(tenants.empresaA), tenants.leadA, {
      numero: '(85) 98888-1234',
      rotulo: 'Recepção',
    });

    expect(telefone.id).toBeTruthy();
    expect(telefone.numero).toBe('5585988881234');
    expect(telefone.rotulo).toBe('Recepção');
    expect(telefone.leadId).toBe(tenants.leadA);
    expect(telefone.empresaId).toBe(tenants.empresaA);
  });

  test('recusa telefone repetido contra o principal, inclusive com a variação do nono dígito @spec:AC-161', async () => {
    const ctx = contextoDe(tenants.empresaA);

    // Principal `+5585999985587` sem o nono dígito.
    await expect(
      criarTelefoneLead(db, ctx, LEAD_COM_TELEFONES, { numero: '558599985587' })
    ).rejects.toBeInstanceOf(ErroTelefoneDuplicado);

    // Principal sem DDI e sem nono dígito (recebe DDI 55 e bate com a grafia com nono).
    await expect(
      criarTelefoneLead(db, ctx, LEAD_COM_TELEFONES, { numero: '85999985587' })
    ).rejects.toBeInstanceOf(ErroTelefoneDuplicado);
  });

  test('recusa telefone repetido contra outro extra do mesmo lead @spec:AC-161', async () => {
    await expect(
      criarTelefoneLead(db, contextoDe(tenants.empresaA), LEAD_COM_TELEFONES, { numero: '5585988887777' })
    ).rejects.toBeInstanceOf(ErroTelefoneDuplicado);
  });

  test('o mesmo número cadastrado em outro lead da mesma empresa não é duplicidade @spec:AC-161', async () => {
    // "Dentro do mesmo lead" — a duplicidade de AC-161 não se estende a leads
    // diferentes; esse é o papel do desempate de localização (fora de T-073).
    const telefone = await criarTelefoneLead(db, contextoDe(tenants.empresaA), tenants.leadA, {
      numero: '5585988887777',
    });
    expect(telefone.numero).toBe('5585988887777');
  });

  test('lista o principal e os extras, remove só o extra do próprio lead @spec:AC-163', async () => {
    const ctx = contextoDe(tenants.empresaA);

    const antes = await listarTelefonesLead(db, ctx, LEAD_COM_TELEFONES);
    expect(antes?.principal).toBe('5585999985587');
    expect(antes?.extras).toHaveLength(1);
    expect(antes?.extras[0]).toMatchObject({ id: EXTRA_JA_CADASTRADO, numero: '5585988887777', rotulo: 'Sócio' });

    const removeuDeOutroLead = await removerTelefoneLead(db, ctx, tenants.leadA, EXTRA_JA_CADASTRADO);
    expect(removeuDeOutroLead).toBe(false);

    const removeu = await removerTelefoneLead(db, ctx, LEAD_COM_TELEFONES, EXTRA_JA_CADASTRADO);
    expect(removeu).toBe(true);

    const depois = await listarTelefonesLead(db, ctx, LEAD_COM_TELEFONES);
    expect(depois?.extras).toHaveLength(0);
  });

  test('lead inexistente ou de outro tenant: listar devolve null, remover devolve false, cadastrar recusa @spec:AC-163', async () => {
    const ctx = contextoDe(tenants.empresaA);
    const inexistente = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

    expect(await listarTelefonesLead(db, ctx, inexistente)).toBeNull();
    expect(await removerTelefoneLead(db, ctx, inexistente, EXTRA_JA_CADASTRADO)).toBe(false);
    await expect(
      criarTelefoneLead(db, ctx, inexistente, { numero: '5585977776666' })
    ).rejects.toBeInstanceOf(ErroLeadNaoEncontrado);
  });

  test('telefones de uma empresa não aparecem, não cadastram duplicidade nem são removíveis pela outra @spec:AC-164', async () => {
    const ctxA = contextoDe(tenants.empresaA);
    const ctxB = contextoDe(tenants.empresaB);

    // Mesmo número cadastrado como extra em cada empresa — não é duplicidade entre tenants.
    const extraA = await criarTelefoneLead(db, ctxA, tenants.leadA, { numero: '5585966665555' });
    const extraB = await criarTelefoneLead(db, ctxB, tenants.leadB, { numero: '5585966665555' });
    expect(extraA.numero).toBe(extraB.numero);
    expect(extraA.empresaId).not.toBe(extraB.empresaId);

    // B não vê o lead da A nem o telefone dele.
    expect(await listarTelefonesLead(db, ctxB, tenants.leadA)).toBeNull();
    expect(await listarTelefonesLead(db, ctxB, LEAD_COM_TELEFONES)).toBeNull();

    // B não cadastra em lead da A (RLS/filtro, não UPDATE em linha de outro tenant).
    await expect(
      criarTelefoneLead(db, ctxB, tenants.leadA, { numero: '5585955554444' })
    ).rejects.toBeInstanceOf(ErroLeadNaoEncontrado);

    // B não remove o extra da A.
    expect(await removerTelefoneLead(db, ctxB, tenants.leadA, extraA.id)).toBe(false);
    const aindaExisteNaA = await listarTelefonesLead(db, ctxA, tenants.leadA);
    expect(aindaExisteNaA?.extras.some((extra) => extra.id === extraA.id)).toBe(true);
  });
});
