// T-263 (fase5-email-config, AC-698): a página existe, o menu mostra "E-mail" a gerente e master e a matriz de rotas barra o atendente.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { podeAcessarRota } from '../../src/lib/auth/rotas';
import { encontrarItemAtivo, menuParaPapel } from '../../src/components/shell/menu-config';

describe('T-263: menu e rotas do e-mail da empresa', () => {
  test('a página existe e o menu mostra "E-mail" a gerente e master, não ao atendente @spec:AC-698', () => {
    expect(existsSync(join(__dirname, '..', '..', 'src/app/(app)/configuracoes/email/page.tsx'))).toBe(true);
    for (const papel of ['GERENTE', 'MASTER'] as const) {
      const adm = menuParaPapel(papel, false).find((g) => g.titulo === 'Administração');
      expect(adm!.itens.find((i) => i.href === '/configuracoes/email')?.rotulo, papel).toBe('E-mail');
    }
    expect(menuParaPapel('ATENDENTE', false).flatMap((g) => g.itens.map((i) => i.href))).not.toContain('/configuracoes/email');
    expect(encontrarItemAtivo(menuParaPapel('MASTER', false), '/configuracoes/email')?.href).toBe('/configuracoes/email');
  });

  test('o atendente é barrado na tela e na API; gerente e master entram @spec:AC-698', () => {
    for (const rota of ['/configuracoes/email', '/api/configuracoes/email']) {
      expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, rota), rota).toBe(false);
      expect(podeAcessarRota({ papel: 'GERENTE', isSuperAdmin: false }, rota), rota).toBe(true);
      expect(podeAcessarRota({ papel: 'MASTER', isSuperAdmin: false }, rota), rota).toBe(true);
    }
  });
});
