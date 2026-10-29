// T-249 (fase5-whatsapp-lote-base, AC-673): a página de templates existe e o item "Templates" está no menu de Comunicação.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { encontrarItemAtivo, menuParaPapel } from '../../src/components/shell/menu-config';

describe('T-249: menu e rota de templates', () => {
  test('a página existe e todos os papéis veem "Templates" em Comunicação @spec:AC-673', () => {
    expect(existsSync(join(__dirname, '..', '..', 'src/app/(app)/whatsapp/templates/page.tsx'))).toBe(true);
    for (const papel of ['ATENDENTE', 'GERENTE', 'MASTER'] as const) {
      const comunicacao = menuParaPapel(papel, false).find((g) => g.titulo === 'Comunicação');
      expect(comunicacao!.itens.find((i) => i.href === '/whatsapp/templates')?.rotulo, papel).toBe('Templates');
      expect(encontrarItemAtivo(menuParaPapel(papel, false), '/whatsapp/templates')?.href).toBe('/whatsapp/templates');
    }
  });
});
