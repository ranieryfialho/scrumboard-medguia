// T-274 (fase5-email-descadastro, AC-720): o rodapé e os cabeçalhos de descadastro — sem banco.
import { describe, expect, test } from 'vitest';

import { cabecalhosDeDescadastro, prepararCorpoComDescadastro, TEXTO_DO_RODAPE } from '../../src/lib/email/descadastro-rodape';

const LINK = 'https://crm.medguia.cloud/descadastro/abc.def';

describe('T-274: rodapé e cabeçalhos de descadastro', () => {
  test('o rodapé entra antes de </body> quando existe, e no fim quando não @spec:AC-720', () => {
    const comBody = prepararCorpoComDescadastro('<html><body><p>Oi</p></body></html>', LINK);
    expect(comBody).toContain(`<a href="${LINK}">clique aqui</a>`);
    expect(comBody.indexOf(LINK)).toBeLessThan(comBody.indexOf('</body>'));
    expect(comBody.endsWith('</body></html>')).toBe(true);
    expect(prepararCorpoComDescadastro('<p>Oi</p>', LINK).startsWith('<p>Oi</p><p')).toBe(true);
    expect(prepararCorpoComDescadastro('<P>Oi</P></BODY>', LINK)).toContain(LINK);
    expect(comBody.replace(/<[^>]+>/g, '')).toContain(TEXTO_DO_RODAPE);
  });

  test('se o corpo já tem o link, o rodapé não se repete @spec:AC-720', () => {
    const uma = prepararCorpoComDescadastro('<p>Oi</p>', LINK);
    expect(prepararCorpoComDescadastro(uma, LINK)).toBe(uma);
    expect(prepararCorpoComDescadastro(`<p><a href="${LINK}">sair</a></p>`, LINK)).toBe(`<p><a href="${LINK}">sair</a></p>`);
  });

  test('os cabeçalhos pedem o descadastro por um clique @spec:AC-720', () => {
    expect(cabecalhosDeDescadastro(LINK)).toEqual({ 'List-Unsubscribe': `<${LINK}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
  });
});
