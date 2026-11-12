// @vitest-environment jsdom
//
// A coluna da direita da conversa (src/components/pipeline/conversa/painel-lateral.tsx): "Notas Internas" fica no topo, e os demais blocos
// seguem na ordem de sempre. Fetch falso, mesmo molde de conversa-tela.test.tsx e blocos-comerciais.test.tsx.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { PainelLateral } from '../../../src/components/pipeline/conversa/painel-lateral';

const CARD = 'cccccccc-0000-0000-0000-0000000000c1';
const resposta = (corpo: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(corpo) } as Response);

describe('coluna da direita da conversa: ordem dos blocos', () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn((url: string) => {
      if (url.endsWith('/cadencia')) return resposta({ iniciada: false });
      if (url.includes('/linha-do-tempo')) return resposta({ itens: [] });
      if (url.endsWith('/comercial')) {
        return resposta({ previsaoFechamento: null, condicaoEspecial: null, plano: null, porteClinica: null, prontuarioLegado: null, faturamentoTiss: null, termoLgpdValidado: false });
      }
      return resposta({});
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  test('"Notas Internas" vem primeiro, depois Cadência Comercial, Dados da Proposta e Qualificação Técnica', async () => {
    render(<PainelLateral cardId={CARD} valor={null} />);
    await waitFor(() => expect(screen.getByText('Qualificação Técnica')).toBeTruthy());

    const aside = screen.getByRole('complementary', { name: 'Painel do card' });
    // o nome do ícone (Material Symbols) vem dentro do título de alguns blocos; só o texto do título interessa
    const titulos = Array.from(aside.querySelectorAll('h2, h3')).map((t) => (t.textContent ?? '').replace(/^(request_quote|fact_check)/, '').trim());
    expect(titulos).toEqual(['Notas Internas', 'Cadência Comercial', 'Dados da Proposta', 'Qualificação Técnica']);
  });
});
