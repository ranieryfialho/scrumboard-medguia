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
const MODULOS_COM_CAMPANHAS = ['pipeline', 'tarefas', 'agenda', 'whatsapp', 'campanhas'];

describe('T-200: menu, rotas e páginas de campanhas', () => {
  test('o item Campanhas aparece a gerente e master, ao atendente só com o módulo liberado, e as três páginas existem @spec:AC-553', () => {
    for (const papel of ['GERENTE', 'MASTER'] as PapelUsuario[]) {
      const campanhas = menuParaPapel(papel, false).flatMap((g) => g.itens).find((i) => i.id === 'campanhas');
      expect(campanhas?.href, `${papel} precisa ver "Campanhas"`).toBe('/campanhas');
    }
    // atendente: não vê por padrão; vê quando o master ou o gerente libera o módulo
    expect(menuParaPapel('ATENDENTE', false).flatMap((g) => g.itens).some((i) => i.id === 'campanhas')).toBe(false);
    expect(menuParaPapel('ATENDENTE', false, MODULOS_COM_CAMPANHAS).flatMap((g) => g.itens).find((i) => i.id === 'campanhas')?.href).toBe('/campanhas');
    for (const pagina of PAGINAS) {
      expect(existsSync(join(RAIZ, pagina)), `falta a página ${pagina}`).toBe(true);
    }
  });

  test('a casca marca "Campanhas" nas três rotas e nenhuma é pública @spec:AC-553', () => {
    for (const papel of PAPEIS) {
      // o atendente só alcança as páginas de campanhas com o módulo liberado; gerente e master por padrão
      const modulos = papel === 'ATENDENTE' ? MODULOS_COM_CAMPANHAS : undefined;
      for (const rota of ROTAS) {
        expect(ehRotaPublica(rota)).toBe(false);
        expect(podeAcessarRota({ papel, isSuperAdmin: false, modulos }, rota)).toBe(true);
        expect(encontrarItemAtivo(menuParaPapel(papel, false, modulos), rota)?.href).toBe('/campanhas');
      }
    }
    for (const rota of ROTAS) expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, rota)).toBe(false);
  });
});
