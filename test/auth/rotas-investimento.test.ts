// T-228 (fase5-investimento-midia, AC-633/AC-639): a página existe, o menu a mostra só a gerente e
// master e a matriz de rotas barra o atendente, na tela e na API.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { podeAcessarRota } from '../../src/lib/auth/rotas';
import { encontrarItemAtivo, menuParaPapel } from '../../src/components/shell/menu-config';

describe('T-228: menu e rotas de investimento', () => {
  test('a página existe e o menu mostra "Investimento em Mídia" a gerente e master, não ao atendente @spec:AC-639', () => {
    expect(existsSync(join(__dirname, '..', '..', 'src/app/(app)/configuracoes/investimento/page.tsx'))).toBe(true);
    for (const papel of ['GERENTE', 'MASTER'] as const) {
      const adm = menuParaPapel(papel, false).find((g) => g.titulo === 'Administração');
      const item = adm!.itens.find((i) => i.href === '/configuracoes/investimento');
      expect(item?.rotulo).toBe('Investimento em Mídia');
    }
    expect(menuParaPapel('ATENDENTE', false).flatMap((g) => g.itens.map((i) => i.href))).not.toContain('/configuracoes/investimento');
    expect(encontrarItemAtivo(menuParaPapel('MASTER', false), '/configuracoes/investimento')?.href).toBe('/configuracoes/investimento');
  });

  test('o atendente é barrado na tela e na API; gerente e master entram @spec:AC-633', () => {
    for (const rota of ['/configuracoes/investimento', '/api/investimento']) {
      expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, rota), rota).toBe(false);
      expect(podeAcessarRota({ papel: 'GERENTE', isSuperAdmin: false }, rota), rota).toBe(true);
      expect(podeAcessarRota({ papel: 'MASTER', isSuperAdmin: false }, rota), rota).toBe(true);
    }
  });
});
