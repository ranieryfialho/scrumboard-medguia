// T-218 (fase4-admin, US-143): os itens de Administração do menu e as seis rotas apontam para
// páginas que existem, a casca marca o item certo e cada papel só acessa o que pode. Sem banco:
// matriz de rotas e menu como funções puras.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { ehRotaPublica, podeAcessarRota } from '../../src/lib/auth/rotas';
import { encontrarItemAtivo, menuParaPapel } from '../../src/components/shell/menu-config';
import type { PapelUsuario } from '../../src/lib/auth/convites';

const RAIZ = join(__dirname, '..', '..');
const PAGINAS = [
  'src/app/(app)/equipe/page.tsx',
  'src/app/(app)/equipe/convidar/page.tsx',
  'src/app/(app)/configuracoes/motivos-perda/page.tsx',
  'src/app/(app)/admin/empresas/page.tsx',
  'src/app/(app)/admin/empresas/nova/page.tsx',
  'src/app/(app)/admin/empresas/[id]/page.tsx',
];
const ROTAS: Array<[string, string]> = [
  ['/equipe', '/equipe'],
  ['/equipe/convidar', '/equipe'],
  ['/configuracoes/motivos-perda', '/configuracoes/motivos-perda'],
  ['/admin/empresas', '/admin/empresas'],
  ['/admin/empresas/nova', '/admin/empresas'],
  ['/admin/empresas/abc-123', '/admin/empresas'],
];
const GERENTES: PapelUsuario[] = ['GERENTE', 'MASTER'];

describe('T-218: menu, rotas e páginas de administração', () => {
  test('as seis páginas existem e o menu mostra Equipe e Motivos a gerente e master, e Empresas só ao super admin @spec:AC-613', () => {
    for (const pagina of PAGINAS) expect(existsSync(join(RAIZ, pagina)), `falta a página ${pagina}`).toBe(true);

    for (const papel of GERENTES) {
      const administracao = menuParaPapel(papel, false).find((g) => g.titulo === 'Administração');
      expect(administracao, `${papel} precisa ver o grupo Administração`).toBeTruthy();
      const itens = administracao!.itens.map((i) => i.href);
      expect(itens).toContain('/equipe');
      expect(itens).toContain('/configuracoes/motivos-perda');
      expect(itens).not.toContain('/admin/empresas');
    }
    const super_ = menuParaPapel('GERENTE', true).find((g) => g.titulo === 'Administração');
    expect(super_!.itens.map((i) => i.href)).toContain('/admin/empresas');
    expect(menuParaPapel('ATENDENTE', false).find((g) => g.titulo === 'Administração')).toBeUndefined();
  });

  test('a casca marca o item certo em cada rota e o acesso segue o papel, nas telas e nas APIs @spec:AC-613', () => {
    for (const [rota, item] of ROTAS) {
      expect(ehRotaPublica(rota)).toBe(false);
      expect(encontrarItemAtivo(menuParaPapel('MASTER', true), rota)?.href).toBe(item);
      expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, rota)).toBe(false);
      expect(podeAcessarRota({ papel: 'MASTER', isSuperAdmin: true }, rota)).toBe(true);
      const soSuper = rota.startsWith('/admin/empresas');
      for (const papel of GERENTES) {
        expect(podeAcessarRota({ papel, isSuperAdmin: false }, rota), `${papel} em ${rota}`).toBe(!soSuper);
      }
    }
    for (const api of ['/api/equipe', '/api/equipe/convites', '/api/configuracoes/motivos-perda']) {
      expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, api)).toBe(false);
      expect(podeAcessarRota({ papel: 'GERENTE', isSuperAdmin: false }, api)).toBe(true);
    }
    expect(podeAcessarRota({ papel: 'MASTER', isSuperAdmin: false }, '/api/admin/empresas')).toBe(false);
    expect(podeAcessarRota({ papel: 'MASTER', isSuperAdmin: true }, '/api/admin/empresas')).toBe(true);
  });
});
