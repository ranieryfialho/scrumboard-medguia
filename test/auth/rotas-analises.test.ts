// T-208 (fase4-analises, US-136): os itens "Indicadores", "Relatórios" e "Comercial" do
// menu apontam para as páginas novas dentro da casca, as três telas antigas (que liam a
// planilha) saíram, e o ATENDENTE continua sem acesso. Sem banco: funções puras.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { ehRotaPublica, podeAcessarRota } from '../../src/lib/auth/rotas';
import { encontrarItemAtivo, menuParaPapel } from '../../src/components/shell/menu-config';
import type { PapelUsuario } from '../../src/lib/auth/convites';

const RAIZ = join(__dirname, '..', '..');
const ITENS = [
  { id: 'indicadores', href: '/indicadores', nova: 'src/app/(app)/indicadores/page.tsx', antiga: 'src/app/indicadores/page.tsx' },
  { id: 'relatorios', href: '/relatorios', nova: 'src/app/(app)/relatorios/page.tsx', antiga: 'src/app/relatorios/page.tsx' },
  { id: 'comercial', href: '/relatorios-comerciais', nova: 'src/app/(app)/relatorios-comerciais/page.tsx', antiga: 'src/app/relatorios-comerciais/page.tsx' },
];
const GERENTES: PapelUsuario[] = ['GERENTE', 'MASTER'];

describe('T-208: menu, rotas e páginas de análises', () => {
  test('GERENTE e MASTER veem os três itens, cada um com a página nova, e as antigas não existem @spec:AC-575', () => {
    for (const papel of GERENTES) {
      const analises = menuParaPapel(papel, false).find((g) => g.titulo === 'Análises');
      expect(analises, `${papel} precisa ver o grupo Análises`).toBeTruthy();
      for (const item of ITENS) {
        expect(analises!.itens.find((i) => i.id === item.id)?.href).toBe(item.href);
      }
    }
    for (const item of ITENS) {
      expect(existsSync(join(RAIZ, item.nova)), `falta a página ${item.nova}`).toBe(true);
      expect(existsSync(join(RAIZ, item.antiga)), `a tela antiga ${item.antiga} não pode existir`).toBe(false);
    }
  });

  test('o ATENDENTE não vê o grupo nem acessa as rotas e a API; a casca marca o item certo @spec:AC-575', () => {
    expect(menuParaPapel('ATENDENTE', false).find((g) => g.titulo === 'Análises')).toBeUndefined();
    for (const item of ITENS) {
      expect(ehRotaPublica(item.href)).toBe(false);
      expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, item.href)).toBe(false);
      for (const papel of GERENTES) {
        expect(podeAcessarRota({ papel, isSuperAdmin: false }, item.href)).toBe(true);
        expect(encontrarItemAtivo(menuParaPapel(papel, false), item.href)?.href).toBe(item.href);
      }
    }
    for (const api of ['/api/relatorios/kpis', '/api/relatorios/funil', '/api/relatorios/marketing', '/api/relatorios/comercial']) {
      expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, api)).toBe(false);
      expect(podeAcessarRota({ papel: 'GERENTE', isSuperAdmin: false }, api)).toBe(true);
    }
  });
});
