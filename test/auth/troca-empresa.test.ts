// Testes de T-032 (fase1-auth-rbac, US-019): troca de empresa pelo super
// admin. Não precisa de Postgres efêmero — a troca é resolvida em memória
// por token de sessão (ver comentário em src/lib/auth/troca-empresa.ts sobre
// a ausência de coluna/tabela dedicada no schema atual).
import { describe, expect, test } from 'vitest';

import {
  empresaAtivaResolvida,
  ErroTrocaEmpresaNaoAutorizada,
  trocarEmpresaAtiva,
  type AtorTrocaEmpresa,
  type EventoAuditoriaTrocaEmpresa,
} from '../../src/lib/auth/troca-empresa';

const EMPRESA_X = 'eeeeeeee-0000-0000-0000-000000000001';
const EMPRESA_Y = 'eeeeeeee-0000-0000-0000-000000000002';

const SUPER_ADMIN = 'eeeeeeee-0000-0000-0000-000000000011';
const USUARIO_COMUM = 'eeeeeeee-0000-0000-0000-000000000012';

function ator(overrides: Partial<AtorTrocaEmpresa>): AtorTrocaEmpresa {
  return {
    usuarioId: SUPER_ADMIN,
    empresaId: EMPRESA_X,
    isSuperAdmin: true,
    ...overrides,
  };
}

describe('T-032: troca de empresa pelo super admin', () => {
  describe('AC-045: super admin troca de empresa com evento de auditoria', () => {
    test('super admin atuando na empresa X troca para a empresa Y: próxima resolução retorna Y @spec:AC-045', async () => {
      const token = 'sessao-super-admin-1';

      const resultado = await trocarEmpresaAtiva(
        ator({ empresaId: EMPRESA_X }),
        token,
        EMPRESA_Y
      );

      expect(resultado).toEqual({ empresaAnteriorId: EMPRESA_X, empresaNovaId: EMPRESA_Y });
      expect(empresaAtivaResolvida(token, EMPRESA_X)).toBe(EMPRESA_Y);
    });

    test('troca registra evento de auditoria com usuário, empresa anterior e nova @spec:AC-045', async () => {
      const token = 'sessao-super-admin-2';
      const eventos: EventoAuditoriaTrocaEmpresa[] = [];

      await trocarEmpresaAtiva(ator({ empresaId: EMPRESA_X }), token, EMPRESA_Y, {
        agora: () => new Date('2026-01-01T00:00:00.000Z'),
        registrarAuditoria: (evento) => {
          eventos.push(evento);
        },
      });

      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toEqual({
        tipo: 'troca_empresa_super_admin',
        atorId: SUPER_ADMIN,
        empresaAnteriorId: EMPRESA_X,
        empresaNovaId: EMPRESA_Y,
        ocorreuEm: new Date('2026-01-01T00:00:00.000Z'),
      });
    });

    test('segunda troca na mesma sessão usa a empresa anterior real (não a original) @spec:AC-045', async () => {
      const token = 'sessao-super-admin-3';
      const eventos: EventoAuditoriaTrocaEmpresa[] = [];
      const registrarAuditoria = (evento: EventoAuditoriaTrocaEmpresa) => {
        eventos.push(evento);
      };

      await trocarEmpresaAtiva(ator({ empresaId: EMPRESA_X }), token, EMPRESA_Y, {
        registrarAuditoria,
      });
      expect(empresaAtivaResolvida(token, EMPRESA_X)).toBe(EMPRESA_Y);

      const EMPRESA_Z = 'eeeeeeee-0000-0000-0000-000000000003';
      const resultado = await trocarEmpresaAtiva(ator({ empresaId: EMPRESA_X }), token, EMPRESA_Z, {
        registrarAuditoria,
      });

      expect(resultado).toEqual({ empresaAnteriorId: EMPRESA_Y, empresaNovaId: EMPRESA_Z });
      expect(eventos).toHaveLength(2);
      expect(eventos[1].empresaAnteriorId).toBe(EMPRESA_Y);
      expect(empresaAtivaResolvida(token, EMPRESA_X)).toBe(EMPRESA_Z);
    });
  });

  describe('AC-046: usuário comum não pode alternar de empresa', () => {
    test('usuário sem is_super_admin é recusado @spec:AC-046', async () => {
      const token = 'sessao-usuario-comum-1';

      await expect(
        trocarEmpresaAtiva(
          ator({ usuarioId: USUARIO_COMUM, empresaId: EMPRESA_X, isSuperAdmin: false }),
          token,
          EMPRESA_Y
        )
      ).rejects.toThrow(ErroTrocaEmpresaNaoAutorizada);
    });

    test('após a recusa, o empresa_id resolvido da sessão continua sendo X @spec:AC-046', async () => {
      const token = 'sessao-usuario-comum-2';

      await expect(
        trocarEmpresaAtiva(
          ator({ usuarioId: USUARIO_COMUM, empresaId: EMPRESA_X, isSuperAdmin: false }),
          token,
          EMPRESA_Y
        )
      ).rejects.toThrow(ErroTrocaEmpresaNaoAutorizada);

      expect(empresaAtivaResolvida(token, EMPRESA_X)).toBe(EMPRESA_X);
    });

    test('recusa não registra evento de auditoria @spec:AC-046', async () => {
      const token = 'sessao-usuario-comum-3';
      const eventos: EventoAuditoriaTrocaEmpresa[] = [];

      await expect(
        trocarEmpresaAtiva(
          ator({ usuarioId: USUARIO_COMUM, empresaId: EMPRESA_X, isSuperAdmin: false }),
          token,
          EMPRESA_Y,
          {
            registrarAuditoria: (evento) => {
              eventos.push(evento);
            },
          }
        )
      ).rejects.toThrow(ErroTrocaEmpresaNaoAutorizada);

      expect(eventos).toHaveLength(0);
    });
  });
});
