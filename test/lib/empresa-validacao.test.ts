// T-239 (fase5-empresa-dados): validação e normalização dos dados cadastrais da empresa.
import { describe, expect, test } from 'vitest';

import { cnpjValido, validarDadosDaEmpresa } from '../../src/lib/empresa/validacao';

const COMPLETO = { razaoSocial: 'Hospital Santa Helena Ltda', cnpj: '11.222.333/0001-81', plano: 'clinica', assentos: 30 };

describe('T-239: validação dos dados da empresa', () => {
  test('CNPJ vale pelos dígitos verificadores, com ou sem pontuação, e recusa sequências repetidas @spec:AC-652', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11222333000181')).toBe(true);
    expect(cnpjValido('11222333000182')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
    expect(cnpjValido('123')).toBe(false);
  });

  test('na criação razão social, CNPJ, plano e assentos são obrigatórios; os dados saem normalizados @spec:AC-651', () => {
    const r = validarDadosDaEmpresa({ ...COMPLETO, cep: '01310-100', logradouro: ' Av. Paulista ', numero: '1000', cidade: 'São Paulo', uf: 'sp' }, { completo: true });
    expect(r).toEqual({
      ok: true,
      dados: { razaoSocial: 'Hospital Santa Helena Ltda', cnpj: '11222333000181', plano: 'clinica', assentos: 30, cep: '01310100', logradouro: 'Av. Paulista', numero: '1000', cidade: 'São Paulo', uf: 'SP' },
    });
    for (const campo of ['razaoSocial', 'cnpj', 'plano', 'assentos']) {
      const { [campo]: _fora, ...resto } = COMPLETO as Record<string, unknown>;
      void _fora;
      expect(validarDadosDaEmpresa(resto, { completo: true }), campo).toMatchObject({ ok: false, campo });
    }
  });

  test('endereço é opcional, mas se vier exige CEP, logradouro, número, cidade e UF @spec:AC-651', () => {
    expect(validarDadosDaEmpresa(COMPLETO, { completo: true }).ok).toBe(true);
    expect(validarDadosDaEmpresa({ ...COMPLETO, bairro: 'Centro' }, { completo: true })).toMatchObject({ ok: false, campo: 'cep' });
    expect(validarDadosDaEmpresa({ ...COMPLETO, cep: '01310100', logradouro: 'Av. X', numero: '1', cidade: 'SP' }, { completo: true })).toMatchObject({ ok: false, campo: 'uf' });
  });

  test('valores inválidos são recusados com o campo @spec:AC-652', () => {
    for (const [mudanca, campo] of [
      [{ cnpj: '11222333000182' }, 'cnpj'],
      [{ plano: 'premium' }, 'plano'],
      [{ assentos: 0 }, 'assentos'],
      [{ assentos: 10_000 }, 'assentos'],
      [{ assentos: 2.5 }, 'assentos'],
      [{ assentos: '30' }, 'assentos'],
      [{ uf: 'XX' }, 'uf'],
      [{ cep: '123' }, 'cep'],
      [{ razaoSocial: 'a' }, 'razaoSocial'],
    ] as Array<[Record<string, unknown>, string]>) {
      expect(validarDadosDaEmpresa({ ...COMPLETO, ...mudanca }, { completo: true }), campo).toMatchObject({ ok: false, campo });
    }
  });

  test('na edição só os campos enviados contam; vazio vira nulo @spec:AC-653', () => {
    expect(validarDadosDaEmpresa({ assentos: 12 }, { completo: false })).toEqual({ ok: true, dados: { assentos: 12 } });
    expect(validarDadosDaEmpresa({ assentos: '', cnpj: '' }, { completo: false })).toEqual({ ok: true, dados: { assentos: null, cnpj: null } });
    expect(validarDadosDaEmpresa({}, { completo: false })).toEqual({ ok: true, dados: {} });
  });
});
