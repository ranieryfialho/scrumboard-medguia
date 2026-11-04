// @vitest-environment jsdom
//
// T-289 (fase4-card-abas, US-114, AC-742): os blocos "Dados da Proposta" e "Qualificação Técnica" da conversa — leitura, edição e
// a porcentagem da qualificação. Fetch falso, mesmo molde de conversa-tela.test.tsx.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DadosDaProposta, QualificacaoTecnica, percentualQualificado } from '../../../src/components/pipeline/conversa/blocos-comerciais';

const CARD = 'cccccccc-0000-0000-0000-0000000000c1';
interface Comerciais {
  previsaoFechamento: string | null;
  condicaoEspecial: string | null;
  plano: string | null;
  porteClinica: string | null;
  prontuarioLegado: string | null;
  faturamentoTiss: string | null;
  termoLgpdValidado: boolean;
}
const VAZIO: Comerciais = {
  previsaoFechamento: null,
  condicaoEspecial: null,
  plano: null,
  porteClinica: null,
  prontuarioLegado: null,
  faturamentoTiss: null,
  termoLgpdValidado: false,
};

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response);
}

const fetchOriginal = globalThis.fetch;
let fetchFalso: ReturnType<typeof vi.fn>;
let doServidor: Comerciais;
let respostaDoPut: (corpo: Record<string, unknown>) => Promise<Response>;
let respostaDoPatch: () => Promise<Response>;

beforeEach(() => {
  doServidor = { ...VAZIO, previsaoFechamento: '2026-11-25', plano: 'Enterprise' };
  respostaDoPut = (corpo) => {
    doServidor = { ...doServidor, ...corpo };
    return resposta(200, { ...doServidor, alteracoes: [] });
  };
  respostaDoPatch = () => resposta(200, { alteracoes: [] });
  fetchFalso = vi.fn((url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    if (url === `/api/oportunidades/${CARD}/comercial` && metodo === 'GET') return resposta(200, doServidor);
    if (url === `/api/oportunidades/${CARD}/comercial` && metodo === 'PUT') return respostaDoPut(JSON.parse(init!.body as string));
    if (url === `/api/oportunidades/${CARD}` && metodo === 'PATCH') return respostaDoPatch();
    return resposta(404, {});
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
});

const corposDe = (metodo: string, url: string) =>
  fetchFalso.mock.calls.filter(([u, i]) => u === url && (i as RequestInit | undefined)?.method === metodo).map(([, i]) => JSON.parse((i as RequestInit).body as string));

describe('T-289: blocos comerciais da conversa', () => {
  test('a proposta mostra MRR, data em dia/mês/ano e traço onde nada foi preenchido @spec:AC-742', async () => {
    render(<DadosDaProposta cardId={CARD} valor="6800.00" />);

    const bloco = await screen.findByRole('region', { name: 'Dados da Proposta' });
    expect(within(bloco).getByText(/6\.800,00/)).toBeTruthy();
    expect(within(bloco).getByText('25/11/2026')).toBeTruthy();
    expect(within(bloco).getByText('Enterprise')).toBeTruthy();
    expect(within(bloco).getByText('Condição Especial:').nextSibling!.textContent).toBe('—');
  });

  test('editar a proposta grava só pelo PUT dos campos comerciais e o MRR pelo PATCH do card, e a tela mostra o novo @spec:AC-742', async () => {
    const usuario = userEvent.setup();
    render(<DadosDaProposta cardId={CARD} valor="6800.00" />);
    await usuario.click(await screen.findByRole('button', { name: 'Editar Dados da Proposta' }));

    await usuario.clear(screen.getByLabelText('MRR ofertado (R$/mês)'));
    await usuario.type(screen.getByLabelText('MRR ofertado (R$/mês)'), '7200');
    await usuario.type(screen.getByLabelText('Condição especial'), '60 Dias Carência');
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull());
    expect(corposDe('PATCH', `/api/oportunidades/${CARD}`)).toEqual([{ valor: 7200 }]);
    expect(corposDe('PUT', `/api/oportunidades/${CARD}/comercial`)).toEqual([
      { previsaoFechamento: '2026-11-25', condicaoEspecial: '60 Dias Carência', plano: 'Enterprise', descontoPercentual: null },
    ]);
    expect(screen.getByText(/7\.200,00/)).toBeTruthy();
    expect(screen.getByText('60 Dias Carência')).toBeTruthy();
  });

  test('sem mudar o MRR, o card não é tocado; se o servidor recusar, mostra o erro e fica editando @spec:AC-742', async () => {
    const usuario = userEvent.setup();
    respostaDoPut = () => resposta(400, { codigo: 'CAMPO_INVALIDO', campo: 'plano' });
    render(<DadosDaProposta cardId={CARD} valor="6800.00" />);
    await usuario.click(await screen.findByRole('button', { name: 'Editar Dados da Proposta' }));
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível salvar');
    expect(screen.getByLabelText('Plano')).toBeTruthy();
    expect(corposDe('PATCH', `/api/oportunidades/${CARD}`)).toEqual([]);
  });

  test('a qualificação mostra a porcentagem dos quatro itens e salva o termo marcado @spec:AC-742', async () => {
    const usuario = userEvent.setup();
    doServidor = { ...VAZIO, porteClinica: '14 consultórios' };
    render(<QualificacaoTecnica cardId={CARD} />);

    const bloco = await screen.findByRole('region', { name: 'Qualificação Técnica' });
    expect(within(bloco).getByText('25% OK')).toBeTruthy();
    expect(within(bloco).getByText('Termo LGPD Validado:').nextSibling!.textContent).toBe('Não');

    await usuario.click(screen.getByRole('button', { name: 'Editar Qualificação Técnica' }));
    await usuario.type(screen.getByLabelText('Prontuário legado'), 'Tasy');
    await usuario.type(screen.getByLabelText('Faturamento TISS'), 'Sim');
    await usuario.click(screen.getByLabelText('Termo LGPD validado'));
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('100% OK')).toBeTruthy();
    expect(corposDe('PUT', `/api/oportunidades/${CARD}/comercial`)[0]).toEqual({
      porteClinica: '14 consultórios',
      prontuarioLegado: 'Tasy',
      faturamentoTiss: 'Sim',
      termoLgpdValidado: true,
    });
  });

  test('a porcentagem conta só itens preenchidos (espaços não valem) @spec:AC-742', () => {
    expect(percentualQualificado({ ...VAZIO })).toBe(0);
    expect(percentualQualificado({ ...VAZIO, porteClinica: '   ', termoLgpdValidado: true })).toBe(25);
    expect(percentualQualificado({ ...VAZIO, porteClinica: 'a', prontuarioLegado: 'b', faturamentoTiss: 'c', termoLgpdValidado: true })).toBe(100);
  });

  test('se a leitura falha, o bloco some em vez de mostrar dado falso @spec:AC-742', async () => {
    fetchFalso.mockImplementation(() => resposta(500, {}));
    const { container } = render(<QualificacaoTecnica cardId={CARD} />);
    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
