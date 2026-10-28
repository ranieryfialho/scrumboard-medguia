// T-212 (fase4-admin, AC-604): se o convite do master falhar, a empresa não fica criada.
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const estado = vi.hoisted(() => ({ falhar: false }));

// Só falha quando o teste pede; o preparo do ambiente também usa `convidarUsuario` de verdade.
vi.mock('../../src/lib/auth/convites', async (original) => {
  const real = await original<typeof import('../../src/lib/auth/convites')>();
  return {
    ...real,
    convidarUsuario: vi.fn(async (...args: Parameters<typeof real.convidarUsuario>) => {
      if (estado.falhar) throw new Error('falha simulada no convite');
      return real.convidarUsuario(...args);
    }),
  };
});

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { criarEmpresa } from '../../src/repositories/empresas-admin';

describe('T-212: criação de empresa com convite que falha', () => {
  let amb: AmbienteAnexos;

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('a empresa e o vínculo não ficam no banco quando o convite falha @spec:AC-604', async () => {
    estado.falhar = true;
    await expect(
      criarEmpresa(
        amb.db,
        { usuarioId: 'ffffffff-0000-0000-0000-0000000000f1', empresaId: amb.tenants.empresaA, papel: 'MASTER', isSuperAdmin: true },
        { nome: 'Clínica Que Não Nasce', slug: 'clinica-que-nao-nasce', masterNome: 'Fulano', masterEmail: 'fulano@x.com' }
      )
    ).rejects.toThrow('falha simulada');
    const r = amb.pg.psqlComo('crm_migrator', `SELECT count(*) FROM empresas WHERE slug = 'clinica-que-nao-nasce'`);
    expect(r.stdout.trim()).toBe('0');
  });
});
