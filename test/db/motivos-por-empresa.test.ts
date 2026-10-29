// T-244 (fase5-motivos-por-empresa, AC-666): a migration 0019 sobre o schema real — os motivos que já
// existiam continuam globais e a unicidade de nome vale por escopo.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';

describe('T-244: schema dos motivos por empresa', () => {
  let amb: AmbienteAnexos;
  function psql(texto: string) {
    return amb.pg.psqlComo('crm_migrator', texto);
  }
  const sql = (texto: string) => {
    const r = psql(texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('os motivos que existiam seguem globais e a cadência esgotada continua sistêmica; nome único por escopo @spec:AC-666', () => {
    expect(sql(`SELECT count(*) FROM motivos_perda WHERE empresa_id IS NOT NULL`)).toBe('0');
    expect(sql(`SELECT count(*) FROM motivos_perda WHERE empresa_id IS NULL`)).toBe('8');
    expect(sql(`SELECT e_sistemico::text FROM motivos_perda WHERE nome = 'Cadência esgotada'`)).toBe('true');
    const { empresaA, empresaB } = amb.tenants;

    // mesmo nome em empresas diferentes: pode; na mesma empresa (ou entre globais, sem diferenciar caixa): não
    expect(psql(`INSERT INTO motivos_perda (nome, empresa_id) VALUES ('Zz Repetido', '${empresaA}'), ('Zz Repetido', '${empresaB}')`).status).toBe(0);
    expect(psql(`INSERT INTO motivos_perda (nome, empresa_id) VALUES ('zz repetido', '${empresaA}')`).status).not.toBe(0);
    expect(psql(`INSERT INTO motivos_perda (nome) VALUES ('sem interesse')`).status).not.toBe(0);
    // sistêmico precisa ser global
    expect(psql(`INSERT INTO motivos_perda (nome, e_sistemico, empresa_id) VALUES ('Zz Sistêmico da A', true, '${empresaA}')`).status).not.toBe(0);
    // o seed segue reaplicável sem duplicar (AC-017)
    expect(psql(`INSERT INTO motivos_perda (nome, ativo, e_sistemico) VALUES ('Sem interesse', true, false) ON CONFLICT DO NOTHING`).status).toBe(0);
    expect(sql(`SELECT count(*) FROM motivos_perda WHERE empresa_id IS NULL`)).toBe('8');
  });
});
