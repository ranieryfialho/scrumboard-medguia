// T-309 (fase4-campanhas, US-130): as verificações do checklist de qualidade do disparo que dependem só do texto.
import { describe, expect, test } from 'vitest';

import { pontosDeAtencao, variaveisDesconhecidas } from '../../src/lib/campanhas/checklist';

describe('T-309: checklist de qualidade do disparo', () => {
  test('só {{nome}} e {{primeiro_nome}} são variáveis conhecidas; as outras são apontadas @spec:AC-778', () => {
    expect(variaveisDesconhecidas('<p>Olá {{primeiro_nome}}, {{ nome }} e {{Nome}}</p>')).toEqual([]);
    expect(variaveisDesconhecidas('<p>{{clinica}} e {{ cidade }} e {{clinica}}</p>')).toEqual(['clinica', 'cidade']);
  });

  test('o assunto em maiúsculas, com exclamações, longo ou com palavra de spam é apontado @spec:AC-779', () => {
    expect(pontosDeAtencao('Olá, tudo bem?', '')).toEqual([]);
    expect(pontosDeAtencao('GANHE AGORA SEU DESCONTO', '').some((p) => /MAIÚSCULAS/.test(p))).toBe(true);
    expect(pontosDeAtencao('Promoção!!! Imperdível', '').some((p) => /exclamações/.test(p))).toBe(true);
    expect(pontosDeAtencao('a'.repeat(81), '').some((p) => /80 caracteres/.test(p))).toBe(true);
    expect(pontosDeAtencao('Teste grátis por 30 dias', '').some((p) => /spam/.test(p))).toBe(true);
  });

  test('o corpo com imagem sem alt, link vazio ou quase sem texto é apontado @spec:AC-780', () => {
    const bom = '<p>Olá, este é um e-mail com texto suficiente para passar.</p><img src="https://x/y.png" alt="logo"><a href="https://medguia.com.br">site</a>';
    expect(pontosDeAtencao('Assunto', bom)).toEqual([]);
    expect(pontosDeAtencao('Assunto', `${bom}<img src="https://x/z.png">`).some((p) => /sem texto alternativo/.test(p))).toBe(true);
    expect(pontosDeAtencao('Assunto', `${bom}<a href="https://">clique</a>`).some((p) => /sem endereço/.test(p))).toBe(true);
    expect(pontosDeAtencao('Assunto', '<img src="https://x/y.png" alt="a">').some((p) => /quase nenhum texto/.test(p))).toBe(true);
    expect(pontosDeAtencao('Assunto', 'x'.repeat(101 * 1024)).some((p) => /100 KB/.test(p))).toBe(true);
  });
});
