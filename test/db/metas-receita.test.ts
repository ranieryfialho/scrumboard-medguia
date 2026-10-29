// T-258 (fase5-meta-receita, AC-693): a migration 0022 sobre o schema real — limite por tipo de meta e valores antigos intactos.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';

describe('T-258: schema da meta de receita', () => {
  let amb: AmbienteAnexos;
  const psql = (texto: string) => amb.pg.psqlComo('crm_migrator', texto);
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

  test('a receita aceita centavos de 0,01 a 99.999.999,99; a porcentagem segue de 0,1 a 100; chave desconhecida é recusada @spec:AC-693', () => {
    const { empresaA, empresaB } = amb.tenants;
    const grava = (empresa: string, chave: string, valor: string) => psql(`INSERT INTO empresa_metas (empresa_id, chave, valor) VALUES ('${empresa}', '${chave}', ${valor})`).status;
    expect(grava(empresaA, 'receita_mensal', '0.01')).toBe(0);
    expect(grava(empresaB, 'receita_mensal', '99999999.99')).toBe(0);
    expect(sql(`SELECT valor::text FROM empresa_metas WHERE empresa_id = '${empresaB}' AND chave = 'receita_mensal'`)).toBe('99999999.99');
    sql(`DELETE FROM empresa_metas`);
    expect(grava(empresaA, 'receita_mensal', '0')).not.toBe(0);
    expect(grava(empresaA, 'receita_mensal', '100000000')).not.toBe(0);
    expect(grava(empresaA, 'taxa_conversao', '100')).toBe(0);
    expect(grava(empresaA, 'taxa_presenca', '0.1')).toBe(0);
    expect(grava(empresaA, 'taxa_entrega_email', '100.01')).not.toBe(0);
    expect(grava(empresaA, 'taxa_cliques_email', '0.05')).not.toBe(0);
    expect(grava(empresaA, 'taxa_abertura_email', '5000')).not.toBe(0); // 5000 só vale para a receita
    expect(grava(empresaA, 'meta_inventada', '10')).not.toBe(0);
    expect(sql(`SELECT count(*) FROM empresa_metas WHERE empresa_id = '${empresaA}'`)).toBe('2');
  });
});
