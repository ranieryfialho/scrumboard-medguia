// T-254 (fase5-whatsapp-lote-disparo, AC-686): a página existe, o menu mostra "Envio em Lote" só a gerente e master, e a
// matriz de rotas barra o atendente na tela e na API.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { podeAcessarRota } from '../../src/lib/auth/rotas';
import { encontrarItemAtivo, menuParaPapel } from '../../src/components/shell/menu-config';

describe('T-254: menu e rotas do envio em lote', () => {
  test('a página existe; "Envio em Lote" aparece para gerente e master (e super admin), não para o atendente @spec:AC-686', () => {
    expect(existsSync(join(__dirname, '..', '..', 'src/app/(app)/whatsapp/lote/page.tsx'))).toBe(true);
    const hrefs = (papel: 'ATENDENTE' | 'GERENTE' | 'MASTER', superAdmin = false) => menuParaPapel(papel, superAdmin).flatMap((g) => g.itens.map((i) => i.href));
    expect(hrefs('GERENTE')).toContain('/whatsapp/lote');
    expect(hrefs('MASTER')).toContain('/whatsapp/lote');
    expect(hrefs('ATENDENTE', true)).toContain('/whatsapp/lote');
    expect(hrefs('ATENDENTE')).not.toContain('/whatsapp/lote');
    expect(encontrarItemAtivo(menuParaPapel('MASTER', false), '/whatsapp/lote')?.rotulo).toBe('Envio em Lote');
  });

  test('o atendente é barrado na tela e na API do lote; gerente e master entram @spec:AC-686', () => {
    for (const rota of ['/whatsapp/lote', '/api/whatsapp/lote', '/api/whatsapp/lote/previa', '/api/whatsapp/lote/abc/cancelar']) {
      expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, rota), rota).toBe(false);
      expect(podeAcessarRota({ papel: 'GERENTE', isSuperAdmin: false }, rota), rota).toBe(true);
      expect(podeAcessarRota({ papel: 'MASTER', isSuperAdmin: false }, rota), rota).toBe(true);
    }
    // os templates continuam abertos a todos (a parte 1 não mudou)
    expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, '/whatsapp/templates')).toBe(true);
  });
});
