// T-183 (fase4-tarefas-agenda, US-120): a tela "Controle de Atrasos e Toques
// Vencidos" (src/components/tarefas/tarefas-atrasadas.tsx).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TarefasAtrasadas } from '../../../src/components/tarefas/tarefas-atrasadas';

type Ouvinte = (evento: unknown) => void;
class FakeEventSource {
  static instancias: FakeEventSource[] = [];
  private ouvintes = new Map<string, Set<Ouvinte>>();
  constructor(public url: string) {
    FakeEventSource.instancias.push(this);
  }
  addEventListener(tipo: string, o: Ouvinte) {
    if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, new Set());
    this.ouvintes.get(tipo)!.add(o);
  }
  removeEventListener(tipo: string, o: Ouvinte) {
    this.ouvintes.get(tipo)?.delete(o);
  }
  close() {}
  disparar(tipo: string, evento: unknown = {}) {
    for (const o of this.ouvintes.get(tipo) ?? []) o(evento);
  }
}

const AGORA = new Date('2026-06-11T09:00:00-03:00').getTime(); // 12:00Z

let contador = 0;
function atrasado(nome: string, minutosAtras: number, o: Partial<{ opId: string; etapaId: number; resp: [string, string]; valor: string }> = {}) {
  contador += 1;
  const [rid, rnome] = o.resp ?? ['u1', 'Ana'];
  return {
    atividade: { id: `at-${contador}`, sequencia: contador, canal: 'telefone', tipo: 'ligacao' },
    oportunidade: { id: o.opId ?? `op-${contador}`, version: 2, etapaId: o.etapaId ?? 5, valor: o.valor ?? '1000', responsavelId: rid },
    lead: { id: `l-${contador}`, nome, telefoneE164: '+5511999990001' },
    atrasado: true,
    liberadaEm: new Date(AGORA - minutosAtras * 60_000).toISOString(),
    responsavel: { id: rid, nome: rnome },
  };
}

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

describe('T-183: TarefasAtrasadas', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let fila: ReturnType<typeof atrasado>[];
  let papel: string;
  let resumo: Record<string, unknown>;

  beforeEach(() => {
    contador = 0;
    FakeEventSource.instancias = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    papel = 'GERENTE';
    fila = [atrasado('Cardio Vida', 225, { valor: '8900' }), atrasado('Gastro Vita', 130, { resp: ['u2', 'Bia'], etapaId: 9 }), atrasado('Morumbi', 90), atrasado('Derma', 45, { resp: ['u2', 'Bia'] })];
    resumo = { atrasados: 4, receitaSobRisco: 41500, cardsEmRisco: 4, ticketMedio: 10375, maiorAtraso: { minutos: 225, leadNome: 'Cardio Vida' } };
    fetchFalso = vi.fn((url: string, init?: { method?: string; body?: string }) => {
      if (url.startsWith('/api/atividades/resumo')) return resposta(200, resumo);
      if (url.startsWith('/api/atividades?')) return resposta(200, { itens: fila });
      if (url === '/api/me') return resposta(200, { papel, isSuperAdmin: false });
      if (url === '/api/pipeline/responsaveis') return resposta(200, { responsaveis: [{ id: 'u1', nome: 'Ana' }, { id: 'u2', nome: 'Bia' }] });
      if (url === '/api/oportunidades/lote/reatribuir' && init?.method === 'POST') {
        const ids = JSON.parse(init.body!).ids as string[];
        return resposta(200, { resultados: ids.map((id) => ({ id, ok: true })), aplicados: ids.length, falhas: 0 });
      }
      if (url.includes('/concluir')) return resposta(200, {});
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    globalThis.fetch = fetchOriginal;
  });

  const linhas = () => screen.queryAllByRole('row').slice(1);

  test('a tela mostra o título do controle de atrasos e os estados de carregando, vazio e erro @spec:AC-472 @spec:AC-498', async () => {
    render(<TarefasAtrasadas />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Controle de Atrasos e Toques Vencidos' })).toBeTruthy();
    cleanup();

    fila = [];
    render(<TarefasAtrasadas />);
    expect(await screen.findByText('Nenhum toque atrasado')).toBeTruthy();
    cleanup();

    globalThis.fetch = vi.fn(() => resposta(500, {})) as unknown as typeof fetch;
    render(<TarefasAtrasadas />);
    expect(await screen.findByText(/Não foi possível carregar/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  test('os indicadores mostram atrasados, receita sob risco com ticket médio e o maior atraso @spec:AC-473', async () => {
    render(<TarefasAtrasadas />);
    await screen.findByText('Receita (MRR) sob risco');
    expect(screen.getByText('Toques atrasados')).toBeTruthy();
    expect(screen.getByText(/41\.500/)).toBeTruthy();
    expect(screen.getByText('Ticket médio em risco:').nextSibling!.textContent).toMatch(/10\.375/);
    expect(screen.getByText('+3h 45m')).toBeTruthy();
    expect(screen.queryByText(/Recuperação de SLA/i)).toBeFalsy();
  });

  test('os quatro cartões seguem o protótipo: etiqueta "Crítico", apoio embaixo de cada um e "Cards em risco" no lugar da recuperação @spec:AC-763', async () => {
    render(<TarefasAtrasadas />);
    await screen.findByText('Receita (MRR) sob risco');

    const cartao = (rotulo: string) => screen.getByText(rotulo).closest('div.rounded-2xl') as HTMLElement;
    const atrasados = cartao('Toques atrasados');
    expect(within(atrasados).getAllByText('4')).toHaveLength(2); // o número grande e o rodapé "Cards afetados"
    expect(within(atrasados).getByText('Crítico')).toBeTruthy();
    expect(within(atrasados).getByText('Cadências bloqueadas sem interação')).toBeTruthy();
    expect(within(atrasados).getByText('Cards afetados:').nextSibling!.textContent).toBe('4');

    const receita = cartao('Receita (MRR) sob risco');
    expect(within(receita).getByText('Valor somado de 4 cards parados')).toBeTruthy();
    expect(within(receita).getByText('/mês')).toBeTruthy();

    const maior = cartao('Maior tempo de atraso');
    expect(within(maior).getByText('Cardio Vida')).toBeTruthy();
    expect(within(maior).getByText('Fila ordenada por:').nextSibling!.textContent).toBe('maior atraso primeiro');

    const emRisco = cartao('Cards em risco');
    expect(within(emRisco).getByText('Cards com ao menos um toque atrasado')).toBeTruthy();
    expect(within(emRisco).getByText('Toques atrasados por card:').nextSibling!.textContent).toBe('1,0');

    // o cabeçalho conta os casos e a classificação muda o rodapé do maior atraso
    expect(screen.getByText('4 casos em risco imediato')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Classificação'), { target: { value: 'menor' } });
    expect(within(cartao('Maior tempo de atraso')).getByText('Fila ordenada por:').nextSibling!.textContent).toBe('menor atraso primeiro');
  });

  test('sem atrasados os cartões mostram zero, "Em dia" e traço, e o cabeçalho não acusa casos @spec:AC-763', async () => {
    fila = [];
    resumo = { atrasados: 0, receitaSobRisco: 0, cardsEmRisco: 0, ticketMedio: null, maiorAtraso: null };
    render(<TarefasAtrasadas />);
    await screen.findByText('Receita (MRR) sob risco');

    const cartao = (rotulo: string) => screen.getByText(rotulo).closest('div.rounded-2xl') as HTMLElement;
    expect(within(cartao('Toques atrasados')).getByText('Em dia')).toBeTruthy();
    expect(within(cartao('Toques atrasados')).queryByText('Crítico')).toBeNull();
    expect(within(cartao('Maior tempo de atraso')).getByText('—')).toBeTruthy();
    expect(within(cartao('Maior tempo de atraso')).getByText('Nada atrasado no momento')).toBeTruthy();
    expect(within(cartao('Receita (MRR) sob risco')).getByText('Nenhum card com toque parado')).toBeTruthy();
    expect(within(cartao('Cards em risco')).getByText('Toques atrasados por card:').nextSibling!.textContent).toBe('—');
    expect(screen.queryByText(/em risco imediato/)).toBeNull();
  });

  test('a fila lista só os atrasados, do maior atraso para o menor, com faixa de cor @spec:AC-474', async () => {
    fila.push({ ...atrasado('Do turno', 10), atrasado: false });
    render(<TarefasAtrasadas />);
    await screen.findByRole('link', { name: 'Cardio Vida' });
    const l = linhas();
    expect(l).toHaveLength(4);
    expect(within(l[0]).getByText('Cardio Vida')).toBeTruthy();
    expect(within(l[0]).getByText('+3h 45m atrasado').className).toMatch(/danger/);
    expect(within(l[3]).getByText('Derma')).toBeTruthy();
    expect(within(l[3]).getByText('+45m atrasado').className).toMatch(/warning/);
    expect(within(l[0]).getByText(/R\$\s?8\.900/)).toBeTruthy();
    expect(within(l[0]).getByText(/Toque #1/)).toBeTruthy();
    expect(screen.queryByText('Do turno')).toBeFalsy();
  });

  test('atraso mínimo, consultor, etapa, ordem e Limpar restringem a fila @spec:AC-475', async () => {
    const usuario = userEvent.setup({ advanceTimers: () => undefined });
    render(<TarefasAtrasadas />);
    await screen.findByRole('link', { name: 'Cardio Vida' });
    await usuario.selectOptions(screen.getByLabelText('Atraso'), '60');
    expect(linhas()).toHaveLength(3);
    await usuario.selectOptions(screen.getByLabelText('Atraso'), '240');
    expect(linhas()).toHaveLength(0);
    await usuario.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(linhas()).toHaveLength(4);

    await usuario.selectOptions(screen.getByLabelText('Consultor'), 'u2');
    expect(linhas()).toHaveLength(2);
    await usuario.selectOptions(screen.getByLabelText('Etapa do funil'), '9');
    expect(linhas()).toHaveLength(1);
    expect(screen.getByText('Exibindo 1 contatos críticos')).toBeTruthy();
    await usuario.click(screen.getByRole('button', { name: 'Limpar' }));

    await usuario.selectOptions(screen.getByLabelText('Classificação'), 'menor');
    expect(within(linhas()[0]).getByText('Derma')).toBeTruthy();
    expect(screen.getByText(/41\.500/)).toBeTruthy();
  });

  test('concluir com sucesso e não atendeu usam a API de concluir com a versão do card @spec:AC-476', async () => {
    const usuario = userEvent.setup({ advanceTimers: () => undefined });
    render(<TarefasAtrasadas />);
    await usuario.click(await screen.findByRole('button', { name: 'Concluir com sucesso: Cardio Vida' }));
    await usuario.click(screen.getByRole('button', { name: 'Não atendeu: Gastro Vita' }));
    await waitFor(() => {
      const corpos = fetchFalso.mock.calls.filter((c) => String(c[0]).includes('/concluir')).map((c) => JSON.parse(c[1].body));
      expect(corpos).toEqual([
        { version: 2, resultado: 'conectou' },
        { version: 2, resultado: 'sem_resposta' },
      ]);
    });
  });

  test('o gerente reatribui os cards marcados (um por card) e vê "N reatribuídos"; o atendente fica desabilitado @spec:AC-477', async () => {
    fila = [atrasado('Dois toques A', 200, { opId: 'op-x' }), atrasado('Dois toques A', 100, { opId: 'op-x' }), atrasado('Outro', 50, { opId: 'op-y' })];
    const usuario = userEvent.setup({ advanceTimers: () => undefined });
    render(<TarefasAtrasadas />);
    await screen.findAllByText('Dois toques A');
    await usuario.click(screen.getByRole('checkbox', { name: 'Marcar todos' }));
    await usuario.click(screen.getByRole('button', { name: 'Reatribuir em Lote' }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.selectOptions(within(dialogo).getByRole('combobox'), 'u2');
    await usuario.click(within(dialogo).getByRole('button', { name: /Reatribuir 2 cards/ }));
    await waitFor(() => {
      const chamada = fetchFalso.mock.calls.find((c) => c[0] === '/api/oportunidades/lote/reatribuir');
      expect(JSON.parse(chamada![1].body)).toEqual({ ids: ['op-x', 'op-y'], responsavelId: 'u2' });
    });
    expect(await screen.findByText(/2 reatribuídos/)).toBeTruthy();
    cleanup();

    papel = 'ATENDENTE';
    render(<TarefasAtrasadas />);
    await screen.findAllByText('Dois toques A');
    await usuario.click(screen.getAllByRole('checkbox', { name: /Marcar Dois/ })[0]);
    await waitFor(() => expect(fetchFalso.mock.calls.filter((c) => c[0] === '/api/me').length).toBeGreaterThan(1));
    expect((screen.getByRole('button', { name: 'Reatribuir em Lote' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('os itens sem backend aparecem "em breve" e o que não existe no sistema não aparece @spec:AC-478', async () => {
    render(<TarefasAtrasadas />);
    await screen.findByRole('link', { name: 'Cardio Vida' });
    for (const rotulo of ['Forçar Mutirão de Regularização', 'Alertar Consultores', 'Exportar Auditoria', 'Notificar Atraso Urgente']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryByText(/Transbordo/i)).toBeFalsy();
    expect(screen.queryByText(/Plantão de Resgate/i)).toBeFalsy();
    expect(screen.queryByText(/Fila Expressa/i)).toBeFalsy();
  });

  test('a tela recarrega ao receber o evento da fila @spec:AC-479', async () => {
    render(<TarefasAtrasadas />);
    await screen.findByRole('link', { name: 'Cardio Vida' });
    fila = [atrasado('Novo Atrasado', 300)];
    await act(async () => {
      FakeEventSource.instancias[0].disparar('cadencia.fila_alterada', { data: JSON.stringify({ tipo: 'cadencia.fila_alterada', empresaId: 'e' }) });
    });
    expect(await screen.findByText('Novo Atrasado')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Cardio Vida' })).toBeFalsy();
  });

  test('o quadro ocupa a altura da tela e só a tabela dos atrasados rola por dentro, com o cabeçalho fixo @spec:AC-762', async () => {
    const { container } = render(<TarefasAtrasadas />);
    await screen.findByText('Fila de Resgate Imediato');

    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.className).toContain('h-[calc(100dvh-4rem)]');
    expect(raiz.className).toContain('min-h-[40rem]');
    expect(raiz.className).toContain('flex-col');

    const secao = screen.getByText('Fila de Resgate Imediato').closest('section') as HTMLElement;
    expect(secao.className).toContain('flex-1');
    expect(secao.className).toContain('min-h-0');

    const rolagem = secao.querySelector('.overflow-auto') as HTMLElement;
    expect(rolagem.className).toContain('min-h-0');
    expect(rolagem.className).toContain('relative');
    expect(rolagem.contains(screen.getByText('Cardio Vida'))).toBe(true);
    expect(rolagem.contains(screen.getByRole('heading', { name: 'Fila de Resgate Imediato' }))).toBe(false);
    expect((rolagem.querySelector('thead') as HTMLElement).className).toContain('sticky');
  });
});
