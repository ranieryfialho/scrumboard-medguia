// T-200 (fase4-campanhas, US-132): o item "Campanhas" do menu e as três rotas filhas
// apontam para páginas que existem (hoje /campanhas dava 404), a casca marca o item
// certo e as rotas exigem sessão. Sem banco: matriz de rotas e menu como funções puras.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { ehRotaPublica, podeAcessarRota } from '../../src/lib/auth/rotas';
import { encontrarItemAtivo, menuParaPapel } from '../../src/components/shell/menu-config';
import type { PapelUsuario } from '../../src/lib/auth/convites';

const RAIZ = join(__dirname, '..', '..');
const PAPEIS: PapelUsuario[] = ['ATENDENTE', 'GERENTE', 'MASTER'];
const PAGINAS = ['src/app/(app)/campanhas/page.tsx', 'src/app/(app)/campanhas/nova/page.tsx', 'src/app/(app)/campanhas/[id]/page.tsx'];
const ROTAS = ['/campanhas', '/campanhas/nova', '/campanhas/abc-123'];

describe('T-200: menu, rotas e páginas de campanhas', () => {
  test('o item Campanhas aparece aos três papéis e as três páginas existem @spec:AC-553', () => {
    for (const papel of PAPEIS) {
      const itens = menuParaPapel(papel, false).flatMap((g) => g.itens);
      const campanhas = itens.find((i) => i.id === 'campanhas');
      expect(campanhas?.href, `${papel} precisa ver "Campanhas"`).toBe('/campanhas');
    }
    for (const pagina of PAGINAS) {
      expect(existsSync(join(RAIZ, pagina)), `falta a página ${pagina}`).toBe(true);
    }
  });

  test('a casca marca "Campanhas" nas três rotas e nenhuma é pública @spec:AC-553', () => {
    for (const papel of PAPEIS) {
      for (const rota of ROTAS) {
        expect(ehRotaPublica(rota)).toBe(false);
        expect(podeAcessarRota({ papel, isSuperAdmin: false }, rota)).toBe(true);
        expect(encontrarItemAtivo(menuParaPapel(papel, false), rota)?.href).toBe('/campanhas');
      }
    }
  });
});
