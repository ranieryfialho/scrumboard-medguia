// T-188 (fase4-tarefas-agenda, US-123): os itens do menu "Tarefas do Turno",
// "Tarefas Atrasadas" e "Agenda" apontam para páginas que existem (o item
// "Tarefas Atrasadas" levava a um 404), não há rota duplicada e a casca marca
// o item certo. Sem banco: matriz de rotas e menu como funções puras.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { ehRotaPublica, podeAcessarRota } from '../../src/lib/auth/rotas';
import { encontrarItemAtivo, menuParaPapel } from '../../src/components/shell/menu-config';
import type { PapelUsuario } from '../../src/lib/auth/convites';

const RAIZ = join(__dirname, '..', '..');
const PAPEIS: PapelUsuario[] = ['ATENDENTE', 'GERENTE', 'MASTER'];
const ROTAS = [
  { href: '/tarefas', pagina: 'src/app/(app)/tarefas/page.tsx' },
  { href: '/tarefas/atrasadas', pagina: 'src/app/(app)/tarefas/atrasadas/page.tsx' },
  { href: '/agenda', pagina: 'src/app/(app)/agenda/page.tsx' },
];

describe('T-188: menu, rotas e páginas de tarefas e agenda', () => {
  test('cada item do menu aponta para uma página que existe, para os três papéis @spec:AC-497', () => {
    for (const papel of PAPEIS) {
      const itens = menuParaPapel(papel, false).flatMap((g) => g.itens);
      for (const { href, pagina } of ROTAS) {
        expect(itens.map((i) => i.href)).toContain(href);
        expect(existsSync(join(RAIZ, pagina)), `${href} precisa da página ${pagina}`).toBe(true);
      }
    }
  });

  test('sem sessão ninguém acessa; com sessão os três papéis passam, e a casca marca o item certo @spec:AC-497', () => {
    for (const { href } of ROTAS) {
      expect(ehRotaPublica(href)).toBe(false);
      for (const papel of PAPEIS) {
        expect(podeAcessarRota({ papel, isSuperAdmin: false }, href)).toBe(true);
        expect(encontrarItemAtivo(menuParaPapel(papel, false), href)?.href).toBe(href);
      }
    }
  });

  test('a tela antiga fora da casca saiu de cena: não há rota duplicada de /tarefas @spec:AC-497', () => {
    expect(existsSync(join(RAIZ, 'src/app/tarefas/page.tsx'))).toBe(false);
    expect(existsSync(join(RAIZ, 'src/app/tarefas'))).toBe(false);
  });
});
