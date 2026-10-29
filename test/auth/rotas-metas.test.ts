// T-223 (fase5-metas, AC-620/AC-626): a tela de metas existe, o menu a mostra só a gerente e master
// e a matriz de rotas barra o atendente na tela; a leitura da API segue aberta a qualquer sessão.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { podeAcessarRota } from '../../src/lib/auth/rotas';
import { encontrarItemAtivo, menuParaPapel } from '../../src/components/shell/menu-config';

describe('T-223: menu e rotas de metas', () => {
  test('a página existe, o menu mostra Metas a gerente e master e não ao atendente @spec:AC-626', () => {
    expect(existsSync(join(__dirname, '..', '..', 'src/app/(app)/configuracoes/metas/page.tsx'))).toBe(true);
    for (const papel of ['GERENTE', 'MASTER'] as const) {
      const adm = menuParaPapel(papel, false).find((g) => g.titulo === 'Administração');
      expect(adm!.itens.map((i) => i.href)).toContain('/configuracoes/metas');
    }
    expect(menuParaPapel('ATENDENTE', false).flatMap((g) => g.itens.map((i) => i.href))).not.toContain('/configuracoes/metas');
    expect(encontrarItemAtivo(menuParaPapel('MASTER', false), '/configuracoes/metas')?.href).toBe('/configuracoes/metas');
  });

  test('o atendente é barrado na tela de metas e os gerentes entram @spec:AC-620', () => {
    expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, '/configuracoes/metas')).toBe(false);
    expect(podeAcessarRota({ papel: 'GERENTE', isSuperAdmin: false }, '/configuracoes/metas')).toBe(true);
    expect(podeAcessarRota({ papel: 'MASTER', isSuperAdmin: false }, '/configuracoes/metas')).toBe(true);
    // a leitura que alimenta os selos é de qualquer sessão
    expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, '/api/metas')).toBe(true);
  });
});
