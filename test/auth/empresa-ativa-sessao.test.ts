// T-280 (fase1-auth-rbac, US-019, AC-728/AC-729): a empresa em que o super admin está atuando é gravada na sessão e vale
// para todos os dados; para os demais usuários a coluna é ignorada. Contra Postgres real, no molde de T-031.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { resolverContextoTenant } from '../../src/lib/auth/tenant';
import { trocarEmpresaAtiva } from '../../src/lib/auth/troca-empresa';

const EMPRESA_X = 'dddddddd-0000-0000-0000-000000000a01';
const EMPRESA_Y = 'dddddddd-0000-0000-0000-000000000a02';
const SUPER_ADMIN = 'dddddddd-0000-0000-0000-000000000a11';
const COMUM = 'dddddddd-0000-0000-0000-000000000a12';
const TOKEN_SUPER = 'token-super-admin-t280';
const TOKEN_COMUM = 'token-usuario-comum-t280';

describe('T-280: empresa ativa gravada na sessão', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  const sql = (texto: string) => {
    const r = pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const auditoria = async () => undefined;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    const expira = new Date(Date.now() + 3_600_000).toISOString();
    sql(`INSERT INTO "empresas" ("id", "nome", "slug") VALUES
           ('${EMPRESA_X}', 'Empresa X', 'empresa-x-t280'), ('${EMPRESA_Y}', 'Empresa Y', 'empresa-y-t280');
         INSERT INTO "usuarios" ("id", "email", "nome", "is_super_admin", "ativo") VALUES
           ('${SUPER_ADMIN}', 'super.t280@teste.com', 'Super Admin', true, true),
           ('${COMUM}', 'comum.t280@teste.com', 'Usuário Comum', false, true);
         INSERT INTO "empresas_usuarios" ("empresa_id", "usuario_id", "papel", "criado_em") VALUES
           ('${EMPRESA_X}', '${SUPER_ADMIN}', 'GERENTE', now()),
           ('${EMPRESA_Y}', '${COMUM}', 'ATENDENTE', now()),
           ('${EMPRESA_X}', '${COMUM}', 'GERENTE', now() - interval '1 day');
         INSERT INTO "sessoes" ("usuario_id", "token", "expira_em") VALUES
           ('${SUPER_ADMIN}', '${TOKEN_SUPER}', '${expira}'), ('${COMUM}', '${TOKEN_COMUM}', '${expira}');`);
    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  test('super admin que troca de empresa passa a resolver a nova empresa, e a escolha fica gravada na sessão (@spec:AC-728)', async () => {
    const antes = await resolverContextoTenant(db, { token: TOKEN_SUPER });
    expect(antes).toMatchObject({ empresaId: EMPRESA_X, papel: 'GERENTE', isSuperAdmin: true });

    await trocarEmpresaAtiva({ usuarioId: SUPER_ADMIN, empresaId: EMPRESA_X, isSuperAdmin: true }, TOKEN_SUPER, EMPRESA_Y, {
      db,
      registrarAuditoria: auditoria,
    });

    // gravada no banco (sobrevive a reinício do servidor) e é o que o resolvedor consulta
    expect(sql(`SELECT empresa_ativa_id FROM sessoes WHERE token = '${TOKEN_SUPER}'`)).toBe(EMPRESA_Y);
    const depois = await resolverContextoTenant(db, { token: TOKEN_SUPER });
    // sem vínculo na empresa escolhida, o super admin atua como MASTER
    expect(depois).toMatchObject({ empresaId: EMPRESA_Y, papel: 'MASTER', isSuperAdmin: true });

    // voltar para a primeira também vale
    await trocarEmpresaAtiva({ usuarioId: SUPER_ADMIN, empresaId: EMPRESA_Y, isSuperAdmin: true }, TOKEN_SUPER, EMPRESA_X, {
      db,
      registrarAuditoria: auditoria,
    });
    expect(await resolverContextoTenant(db, { token: TOKEN_SUPER })).toMatchObject({ empresaId: EMPRESA_X, papel: 'GERENTE' });
  });

  test('usuário comum ignora a empresa gravada na sessão e resolve sempre pelo vínculo mais antigo (@spec:AC-729)', async () => {
    // simula alguém preenchendo a coluna à força: não pode surtir efeito
    sql(`UPDATE sessoes SET empresa_ativa_id = '${EMPRESA_Y}' WHERE token = '${TOKEN_COMUM}'`);

    const contexto = await resolverContextoTenant(db, { token: TOKEN_COMUM });
    expect(contexto).toMatchObject({ empresaId: EMPRESA_X, papel: 'GERENTE', isSuperAdmin: false });
    // determinístico: o vínculo mais antigo (X), e não "o primeiro que o banco devolver"
    expect(await resolverContextoTenant(db, { token: TOKEN_COMUM })).toMatchObject({ empresaId: EMPRESA_X });
  });
});
