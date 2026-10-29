// T-263 (fase5-email-config, AC-699): as variáveis do corpo do e-mail da campanha.
import { describe, expect, test } from 'vitest';

import { escaparHtml, renderizarCorpoDeCampanha } from '../../src/lib/email/campanha-corpo';

describe('T-263: variáveis do e-mail', () => {
  test('{{nome}} é o nome completo e {{primeiro_nome}} o primeiro @spec:AC-699', () => {
    expect(renderizarCorpoDeCampanha('<p>Olá, {{primeiro_nome}}! ({{nome}})</p>', 'Maria Souza')).toBe('<p>Olá, Maria! (Maria Souza)</p>');
    expect(renderizarCorpoDeCampanha('{{ nome }} e {{ primeiro_nome }}', '  Maria   Souza ')).toBe('Maria Souza e Maria');
  });

  test('as grafias do motor anterior continuam valendo e viram o nome completo @spec:AC-699', () => {
    const corpo = '{{Nome}}|{nome}|{Nome}|[nome]|[Nome]|{{nome}}';
    expect(renderizarCorpoDeCampanha(corpo, 'Maria Souza')).toBe('Maria Souza|Maria Souza|Maria Souza|Maria Souza|Maria Souza|Maria Souza');
  });

  test('sem nome vira "Cliente"; variável desconhecida fica como está @spec:AC-699', () => {
    expect(renderizarCorpoDeCampanha('Oi, {{primeiro_nome}} / {{nome}}', null)).toBe('Oi, Cliente / Cliente');
    expect(renderizarCorpoDeCampanha('Oi, {{nome}}', '   ')).toBe('Oi, Cliente');
    expect(renderizarCorpoDeCampanha('Em {{cidade}} e {{ outra }}', 'Maria')).toBe('Em {{cidade}} e {{ outra }}');
  });

  test('o nome é escapado como HTML: um nome com marcação não vira marcação @spec:AC-699', () => {
    const r = renderizarCorpoDeCampanha('<p>Oi {{nome}} / {{primeiro_nome}}</p>', '<script>alert(1)</script> & "Cia"');
    expect(r).not.toContain('<script>');
    expect(r).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Cia&quot;');
    expect(escaparHtml(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;');
  });
});
