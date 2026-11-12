// @vitest-environment jsdom
//
// fase6-qualificacao-comercial (US-198/US-199): o bloco "Qualificação" do card, o selo no funil e a coluna e o filtro da lista.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { BlocoQualificacao } from '../../../src/components/pipeline/detalhe/bloco-qualificacao';
import { BoardKanban } from '../../../src/components/pipeline/board-kanban';
import { FiltrosLista } from '../../../src/components/pipeline/filtros-lista';
import { TabelaLista, type ItemTabelaLista } from '../../../src/components/pipeline/tabela-lista';
import { RESPOSTAS_VAZIAS } from '../../../src/domain/qualificacao/qualificacao';

const json = (corpo: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(corpo) });

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

const salva = {
  respostas: { ...RESPOSTAS_VAZIAS, dor: 25, complexidade: 20, decisao: 15, gatilho: 10, abertura: 10 },
  bloqueios: [],
  estagio: 'residente',
  score: 80,
  faixa: 'A',
  avaliadoPor: 'Ana Souza',
  atualizadoEm: '2026-11-10T15:30:00.000Z',
};

describe('fase6-qualificacao-comercial: bloco no card', () => {
  const fetchOriginal = globalThis.fetch;
  let chamadas: { url: string; metodo: string; corpo?: unknown }[];
  let guardada: unknown;

  beforeEach(() => {
    chamadas = [];
    guardada = { respostas: { ...RESPOSTAS_VAZIAS }, bloqueios: [], estagio: null, score: 0, faixa: null, avaliadoPor: null, atualizadoEm: null };
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      chamadas.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (metodo === 'PUT') return json(salva);
      return json(guardada);
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  const bloco = async () => within(await screen.findByRole('region', { name: 'Qualificação' }));

  test('mostra nota, faixa e recomendação em tempo real a cada resposta @spec:AC-832', async () => {
    render(<BlocoQualificacao oportunidadeId="card-1" />);
    const b = await bloco();
    await b.findByText('Avaliação não iniciada');
    expect(b.getByTestId('nota').textContent).toBe('0');

    fireEvent.change(b.getByLabelText('Dor operacional'), { target: { value: '25' } });
    fireEvent.change(b.getByLabelText('Complexidade da operação'), { target: { value: '20' } });
    fireEvent.change(b.getByLabelText('Poder de decisão'), { target: { value: '15' } });
    fireEvent.change(b.getByLabelText('Gatilho e urgência'), { target: { value: '15' } });
    fireEvent.change(b.getByLabelText('Abertura para adoção'), { target: { value: '10' } });
    expect(b.getByTestId('nota').textContent).toBe('85');
    expect(b.getByText('Alta prioridade · Faixa A')).toBeTruthy();
    expect(b.getByText('Priorizar atendimento')).toBeTruthy();

    fireEvent.click(b.getByLabelText('Impossibilidade de contratar ou acessar um decisor'));
    expect(b.getByText('Revisão obrigatória')).toBeTruthy();
    expect(b.getByTestId('nota').textContent).toBe('85'); // a nota continua calculada
  });

  test('Salvar envia só as respostas (sem nota nem faixa) e mostra quem avaliou e quando; ao reabrir, volta preenchido @spec:AC-832', async () => {
    const { unmount } = render(<BlocoQualificacao oportunidadeId="card-1" />);
    const b = await bloco();
    await b.findByText('Ainda não salva neste card');
    const salvar = b.getByRole('button', { name: 'Salvar qualificação' }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true); // nada mudou ainda

    fireEvent.change(b.getByLabelText('Dor operacional'), { target: { value: '25' } });
    fireEvent.change(b.getByLabelText('Estágio profissional / do consultório'), { target: { value: 'residente' } });
    fireEvent.click(salvar);

    await b.findByText('Qualificação salva.');
    const put = chamadas.find((c) => c.metodo === 'PUT')!;
    expect(put.url).toBe('/api/oportunidades/card-1/qualificacao');
    expect(put.corpo).toEqual({ respostas: { ...RESPOSTAS_VAZIAS, dor: 25 }, bloqueios: [], estagio: 'residente' });
    expect(b.getByText(/Avaliado por Ana Souza em 10\/11\/2026,? 12:30/)).toBeTruthy(); // 15:30 UTC = 12:30 em São Paulo

    // reabrir o card: as respostas guardadas voltam preenchidas
    unmount();
    guardada = salva;
    render(<BlocoQualificacao oportunidadeId="card-1" />);
    const reaberto = await bloco();
    await waitFor(() => expect(reaberto.getByTestId('nota').textContent).toBe('80'));
    expect((reaberto.getByLabelText('Dor operacional') as HTMLSelectElement).value).toBe('25');
    expect((reaberto.getByLabelText('Estágio profissional / do consultório') as HTMLSelectElement).value).toBe('residente');
  });

  test('o estágio residente mostra a jornada do residente sem mudar a nota; sem estágio é "não identificada" @spec:AC-833', async () => {
    render(<BlocoQualificacao oportunidadeId="card-1" />);
    const b = await bloco();
    await b.findByText('Jornada: não identificada');
    fireEvent.change(b.getByLabelText('Dor operacional'), { target: { value: '20' } });
    fireEvent.change(b.getByLabelText('Estágio profissional / do consultório'), { target: { value: 'residente' } });
    expect(b.getByText('Jornada: ICP R · Residente finalista (relacionamento e preparação)')).toBeTruthy();
    expect(b.getByTestId('nota').textContent).toBe('20');
  });

  test('falha ao carregar mostra o erro com "Tentar de novo" @spec:AC-832', async () => {
    globalThis.fetch = vi.fn(() => json({}, 500)) as unknown as typeof fetch;
    render(<BlocoQualificacao oportunidadeId="card-1" />);
    expect(await screen.findByText(/Não foi possível carregar a qualificação/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});

describe('fase6-qualificacao-comercial: selo no funil', () => {
  const fetchOriginal = globalThis.fetch;
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const card = (id: string, nome: string, qualificacao: unknown) => ({ id, etapaId: 5, leadId: `l-${id}`, leadNome: nome, responsavelId: null, responsavelNome: null, valor: null, version: 1, criadoEm: '2026-11-01T12:00:00.000Z', qualificacao });
    globalThis.fetch = vi.fn((url: string) =>
      url === '/api/oportunidades'
        ? json({ itens: [card('a', 'Lead Avaliado', { faixa: 'A', score: 85 }), card('b', 'Lead Em Revisão', { faixa: 'revisao', score: 40 }), card('c', 'Lead Sem Avaliação', null)], grafo: {} })
        : json({}, 404)
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    globalThis.fetch = fetchOriginal;
  });

  test('cada card avaliado mostra o selo com a faixa e a nota; o não avaliado não mostra @spec:AC-834', async () => {
    render(<BoardKanban />);
    await screen.findByText('Lead Avaliado');
    const cardDe = (nome: string) => screen.getByText(nome).closest('[class*="rounded-xl"]') as HTMLElement;

    const avaliado = within(cardDe('Lead Avaliado')).getByTestId('selo-qualificacao');
    expect(avaliado.getAttribute('data-faixa')).toBe('A');
    expect(avaliado.textContent).toContain('85');
    expect(within(cardDe('Lead Em Revisão')).getByTestId('selo-qualificacao').textContent).toContain('Revisão');
    expect(within(cardDe('Lead Sem Avaliação')).queryByTestId('selo-qualificacao')).toBeNull();
  });
});

describe('fase6-qualificacao-comercial: lista', () => {
  afterEach(cleanup);

  const item = (id: string, nome: string, qualificacao: ItemTabelaLista['qualificacao']): ItemTabelaLista => ({
    id, etapaId: 5, valor: null, proximaAcaoEm: null, lead: { id: `l-${id}`, nome, email: null, telefoneE164: null }, responsavel: null, qualificacao,
  });

  test('a coluna Qualificação mostra o selo de cada linha e traço para quem não foi avaliado @spec:AC-835', () => {
    render(<TabelaLista itens={[item('1', 'Lead Um', { faixa: 'B', score: 65 }), item('2', 'Lead Dois', null)]} selecionados={new Set()} onAlternarSelecao={() => {}} onAlternarTodos={() => {}} />);
    expect(screen.getByText('Qualificação')).toBeTruthy();
    const linha = (nome: string) => screen.getByText(nome).closest('tr') as HTMLElement;
    expect(within(linha('Lead Um')).getByTestId('selo-qualificacao').textContent).toContain('Faixa B');
    expect(within(linha('Lead Dois')).queryByTestId('selo-qualificacao')).toBeNull();
  });

  test('o filtro de qualificação oferece as faixas e "Sem avaliação" e avisa a tela do que foi escolhido @spec:AC-835', () => {
    const aoMudar = vi.fn();
    render(<FiltrosLista valor={{ busca: '' }} responsaveis={[]} origens={[]} onMudar={aoMudar} onLimpar={() => {}} />);
    const seletor = screen.getByLabelText('Qualificação') as HTMLSelectElement;
    expect([...seletor.options].map((o) => o.textContent)).toEqual(['Todas as qualificações', 'Faixa A', 'Faixa B', 'Faixa C', 'Baixo fit', 'Revisão', 'Sem avaliação']);

    fireEvent.change(seletor, { target: { value: 'nenhuma' } });
    expect(aoMudar).toHaveBeenLastCalledWith({ qualificacao: 'nenhuma' });
    fireEvent.change(seletor, { target: { value: '' } });
    expect(aoMudar).toHaveBeenLastCalledWith({ qualificacao: undefined });
  });
});
