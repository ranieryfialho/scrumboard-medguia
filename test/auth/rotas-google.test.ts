// T-301 (fase4-tarefas-agenda, AC-765/AC-766): a página do Google Meet existe, o menu a mostra a gerente e master, e a matriz de rotas barra o
// atendente na tela e na API de conexão; o estado do Meet na agenda (`GET /api/reunioes/meet`) é de qualquer sessão.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { podeAcessarRota } from '../../src/lib/auth/rotas';
import { encontrarItemAtivo, menuParaPapel } from '../../src/components/shell/menu-config';

describe('T-301: menu e rotas do Google Meet', () => {
  test('a página existe e o menu mostra "Google Meet" a gerente e master, não ao atendente @spec:AC-765', () => {
    expect(existsSync(join(__dirname, '..', '..', 'src/app/(app)/configuracoes/google/page.tsx'))).toBe(true);
    for (const papel of ['GERENTE', 'MASTER'] as const) {
      const adm = menuParaPapel(papel, false).find((g) => g.titulo === 'Administração');
      expect(adm!.itens.find((i) => i.href === '/configuracoes/google')?.rotulo, papel).toBe('Google Meet');
    }
    expect(menuParaPapel('ATENDENTE', false).flatMap((g) => g.itens.map((i) => i.href))).not.toContain('/configuracoes/google');
    expect(encontrarItemAtivo(menuParaPapel('MASTER', false), '/configuracoes/google')?.href).toBe('/configuracoes/google');
  });

  test('o atendente é barrado na tela e nas rotas de conexão; gerente e master entram; o estado na agenda é de todos @spec:AC-766', () => {
    for (const rota of ['/configuracoes/google', '/api/integracoes/google', '/api/integracoes/google/conectar', '/api/integracoes/google/callback']) {
      expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, rota), rota).toBe(false);
      expect(podeAcessarRota({ papel: 'GERENTE', isSuperAdmin: false }, rota), rota).toBe(true);
      expect(podeAcessarRota({ papel: 'MASTER', isSuperAdmin: false }, rota), rota).toBe(true);
    }
    expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, '/api/reunioes/meet')).toBe(true);
  });
});
