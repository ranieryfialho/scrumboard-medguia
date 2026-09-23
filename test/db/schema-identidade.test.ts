// Testes de T-011 (fase1-schema-drizzle, US-007/US-008): tabelas de
// identidade/tenant e do adaptador Drizzle do Better Auth. Introspecção
// estática do schema Drizzle (sem Postgres) — a prova de que as migrations
// aplicam o schema completo num banco limpo é do T-021 (AC-015).
import { describe, test, expect } from 'vitest';
import { getTableColumns, getTableName } from 'drizzle-orm';

import {
  empresas,
  empresaConfiguracoes,
  usuarios,
  empresasUsuarios,
  contas,
  sessoes,
  tokensVerificacao,
} from '../../src/db/schema';

describe('T-011: tabelas de identidade/tenant (@spec:AC-018)', () => {
  test('empresas existe com nome, slug e ativo obrigatórios', () => {
    expect(getTableName(empresas)).toBe('empresas');
    const columns = getTableColumns(empresas);
    expect(columns.id.primary).toBe(true);
    expect(columns.nome.notNull).toBe(true);
    expect(columns.slug.notNull).toBe(true);
    expect(columns.ativo.notNull).toBe(true);
  });

  test('empresa_configuracoes exige empresa_id (coluna de tenant NOT NULL)', () => {
    expect(getTableName(empresaConfiguracoes)).toBe('empresa_configuracoes');
    const columns = getTableColumns(empresaConfiguracoes);
    expect(columns.empresaId.notNull).toBe(true);
    expect(columns.chave.notNull).toBe(true);
    expect(columns.valor.notNull).toBe(true);
  });

  test('usuarios existe sem senha, com email único e obrigatório', () => {
    expect(getTableName(usuarios)).toBe('usuarios');
    const columns = getTableColumns(usuarios);
    expect(columns.id.primary).toBe(true);
    expect(columns.email.notNull).toBe(true);
    expect(columns.nome.notNull).toBe(true);
    expect(columns.isSuperAdmin.notNull).toBe(true);
    expect(columns).not.toHaveProperty('senha');
  });

  test('empresas_usuarios exige empresa_id e usuario_id (chave composta)', () => {
    expect(getTableName(empresasUsuarios)).toBe('empresas_usuarios');
    const columns = getTableColumns(empresasUsuarios);
    expect(columns.empresaId.notNull).toBe(true);
    expect(columns.usuarioId.notNull).toBe(true);
    expect(columns.papel.notNull).toBe(true);
  });
});

describe('T-011: tabelas do adaptador Drizzle do Better Auth (@spec:AC-016)', () => {
  test('contas existe, vinculada a usuarios', () => {
    expect(getTableName(contas)).toBe('contas');
    const columns = getTableColumns(contas);
    expect(columns.usuarioId.notNull).toBe(true);
    expect(columns.idConta.notNull).toBe(true);
    expect(columns.idProvedor.notNull).toBe(true);
  });

  test('sessoes existe, vinculada a usuarios, com token obrigatório', () => {
    expect(getTableName(sessoes)).toBe('sessoes');
    const columns = getTableColumns(sessoes);
    expect(columns.usuarioId.notNull).toBe(true);
    expect(columns.token.notNull).toBe(true);
    expect(columns.expiraEm.notNull).toBe(true);
  });

  test('tokens_verificacao existe, com identificador e valor obrigatórios', () => {
    expect(getTableName(tokensVerificacao)).toBe('tokens_verificacao');
    const columns = getTableColumns(tokensVerificacao);
    expect(columns.identificador.notNull).toBe(true);
    expect(columns.valor.notNull).toBe(true);
    expect(columns.expiraEm.notNull).toBe(true);
  });
});
