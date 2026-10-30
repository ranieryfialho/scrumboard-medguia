// T-279 (fase3-ingestao-continua, US-090, AC-727): a carga manual e o worker registram os leads sob a MESMA origem em
// `migracao_registros`. Se divergirem, o worker não reconhece nenhum lead já carregado e importa tudo de novo.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import { ORIGEM_ETL_LP } from '../../src/etl/lp/executar';
import { ORIGEM_ETL_SHEETS } from '../../src/etl/sheets/executar';

const ler = (caminho: string): string => readFileSync(caminho, 'utf8');

describe('T-279: origem do ETL da carga manual e do worker', () => {
  test('os valores das origens não mudam: mudar um deles reimporta tudo (@spec:AC-727)', () => {
    expect(ORIGEM_ETL_SHEETS).toBe('sheets-legado-crm');
    expect(ORIGEM_ETL_LP).toBe('supabase-lp');
  });

  test('o worker e os scripts da carga manual usam as mesmas constantes (@spec:AC-727)', () => {
    const worker = ler('src/worker/index.ts');
    expect(worker).toMatch(/origem: ORIGEM_ETL_SHEETS/);
    expect(worker).toMatch(/origem: ORIGEM_ETL_LP/);
    expect(ler('scripts/etl-sheets.ts')).toMatch(/ORIGEM_ETL = ORIGEM_ETL_SHEETS/);
    expect(ler('scripts/etl-lp.ts')).toMatch(/ORIGEM_ETL = ORIGEM_ETL_LP/);
  });
});
