// T-164 (fase4-pipeline-telas, US-110): permissões das quatro telas do pipeline
// e retirada da tela antiga. Sem banco: testa a matriz de rotas e o menu como
// funções puras (a prova com sessão real do middleware é test/auth/middleware.test.ts).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { ehRotaPublica, podeAcessarRota } from '../../src/lib/auth/rotas';
import { encontrarItemAtivo, menuParaPapel } from '../../src/components/shell/menu-config';
import type { PapelUsuario } from '../../src/lib/auth/convites';

const ROTAS_PIPELINE = ['/pipeline', '/pipeline/lista', '/pipeline/arquivados', '/pipeline/abc-123'];
const PAPEIS: PapelUsuario[] = ['ATENDENTE', 'GERENTE', 'MASTER'];
const RAIZ = join(__dirname, '..', '..');

describe('T-164: permissões das telas do pipeline e retirada da tela antiga', () => {
  test('sem sessão, nenhuma das quatro rotas é pública (o middleware manda ao login) @spec:AC-414', () => {
    for (const rota of ROTAS_PIPELINE) {
      expect(ehRotaPublica(rota)).toBe(false);
    }
  });

  test('ATENDENTE, GERENTE e MASTER passam pela matriz de permissões das quatro rotas @spec:AC-414', () => {
    for (const papel of PAPEIS) {
      for (const rota of ROTAS_PIPELINE) {
        expect(podeAcessarRota({ papel, isSuperAdmin: false }, rota)).toBe(true);
      }
    }
  });

  test('o menu mostra Funil, Lista e Arquivados aos três papéis, cada um ativo só na sua tela @spec:AC-414', () => {
    const esperado: Array<[string, string]> = [
      ['/pipeline', '/pipeline'],
      ['/pipeline/lista', '/pipeline/lista'],
      ['/pipeline/arquivados', '/pipeline/arquivados'],
      ['/pipeline/abc-123', '/pipeline'],
    ];
    for (const papel of PAPEIS) {
      const grupos = menuParaPapel(papel, false);
      const hrefs = grupos.flatMap((g) => g.itens.map((i) => i.href));
      expect(hrefs).toEqual(expect.arrayContaining(['/pipeline', '/pipeline/lista', '/pipeline/arquivados']));
      for (const [caminho, itemAtivo] of esperado) {
        expect(encontrarItemAtivo(grupos, caminho)?.href).toBe(itemAtivo);
      }
    }
  });

  test('a tela antiga sem casca saiu de cena: só existe a versão do grupo (app) @spec:AC-415', () => {
    expect(existsSync(join(RAIZ, 'src/app/pipeline/page.tsx'))).toBe(false);
    expect(existsSync(join(RAIZ, 'src/app/pipeline/[id]/page.tsx'))).toBe(false);

    expect(existsSync(join(RAIZ, 'src/app/(app)/pipeline/page.tsx'))).toBe(true);
    expect(existsSync(join(RAIZ, 'src/app/(app)/pipeline/lista/page.tsx'))).toBe(true);
    expect(existsSync(join(RAIZ, 'src/app/(app)/pipeline/arquivados/page.tsx'))).toBe(true);
    expect(existsSync(join(RAIZ, 'src/app/(app)/pipeline/[id]/page.tsx'))).toBe(true);
  });
});
