// Teste de T-175 (fase4-card-abas, US-111): as abas do card existem.
// Lição da PR #37: o teste da época só conferia o `href` dos links, e as rotas
// de cadência, conversa e anexos nem existiam (as abas levavam a um 404).
// Aqui, para cada aba da barra do card, o `href` que ela gera tem que ter o
// `page.tsx` correspondente em `src/app/(app)/pipeline/[id]/`.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { ABAS_DO_CARD, hrefDaAba } from '../../../src/components/pipeline/card/abas-do-card';

const RAIZ = join(__dirname, '..', '..', '..');
const CARD_ID = 'cccccccc-0000-0000-0000-0000000000c1';

/** `/pipeline/<id>/<segmento>` → o arquivo da página do Next dentro de `(app)/pipeline/[id]`. */
function paginaDaRota(href: string): string {
  const resto = href.replace(`/pipeline/${CARD_ID}`, '').replace(/^\//, '');
  return join(RAIZ, 'src/app/(app)/pipeline/[id]', resto, 'page.tsx');
}

describe('T-175: as abas do card não levam a 404', () => {
  test('a barra tem as cinco abas: resumo, cadência, whatsapp, qualificação e anexos @spec:AC-419', () => {
    expect(ABAS_DO_CARD.map((aba) => aba.chave)).toEqual(['resumo', 'cadencia', 'whatsapp', 'qualificacao', 'anexos']);
  });

  test.each(ABAS_DO_CARD.map((aba) => [aba.rotulo, aba.segmento] as const))(
    'a aba "%s" aponta para uma página que existe @spec:AC-419',
    (_rotulo, segmento) => {
      const href = hrefDaAba(CARD_ID, segmento);

      expect(href.startsWith(`/pipeline/${CARD_ID}`)).toBe(true);
      expect(existsSync(paginaDaRota(href))).toBe(true);
    }
  );
});
