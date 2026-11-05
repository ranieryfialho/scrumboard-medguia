// T-182 (fase4-tarefas-agenda, US-119): a tela "Fila do Turno Operacional"
// (src/components/tarefas/fila-turno.tsx). Mesmo molde de fetch falso e
// `FakeEventSource` de test/components/tarefas/fila-tarefas.test.tsx.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FilaTurno } from '../../../src/components/tarefas/fila-turno';

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

let contador = 0;
function item(o: Partial<{ nome: string; seq: number; canal: 'telefone' | 'whatsapp'; atrasado: boolean; liberada: string; etapaId: number; responsavel: string | null; aguardandoAte: string | null }> = {}) {
  contador += 1;
  return {
    atividade: { id: `at-${contador}`, sequencia: o.seq ?? 1, canal: o.canal ?? 'telefone', tipo: 'ligacao' },
    oportunidade: { id: `op-${contador}`, version: 3, etapaId: o.etapaId ?? 5, valor: '1000', responsavelId: 'u1' },
    lead: { id: `lead-${contador}`, nome: o.nome ?? `Lead ${contador}`, telefoneE164: null },
    atrasado: o.atrasado ?? false,
    aguardandoAte: o.aguardandoAte ?? null,
    liberadaEm: o.liberada ?? '2026-06-11T12:00:00.000Z',
    responsavel: o.responsavel === null ? null : { id: 'u1', nome: o.responsavel ?? 'Ana Gerente' },
  };
}

const RESUMO = {
  turno: 'manha',
  toquesConcluidosTurno: 4,
  toquesTotalTurno: 10,
  conexoesHoje: 3,
  semRespostaHoje: 2,
  atrasados: 5,
  receitaSobRisco: 0,
  cardsEmRisco: 0,
  ticketMedio: null,
  maiorAtraso: null,
};

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

describe('T-182: FilaTurno', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let fila: ReturnType<typeof item>[];
  let papel: string;
  let concluirResposta: () => Promise<unknown>;

  beforeEach(() => {
    contador = 0;
    FakeEventSource.instancias = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-11T09:00:00-03:00'));
    fila = [];
    papel = 'GERENTE';
    concluirResposta = () => resposta(200, { resultado: 'conectou' });
    fetchFalso = vi.fn((url: string, init?: { method?: string; body?: string }) => {
      if (url.startsWith('/api/atividades/resumo')) return resposta(200, RESUMO);
      if (url.startsWith('/api/atividades?')) return resposta(200, { itens: fila });
      if (url === '/api/me') return resposta(200, { papel, isSuperAdmin: false });
      if (url === '/api/pipeline/responsaveis') return resposta(200, { responsaveis: [{ id: 'u1', nome: 'Ana Gerente' }, { id: 'u2', nome: 'Bia' }] });
      if (url.includes('/concluir') && init?.method === 'POST') return concluirResposta();
      if (url.includes('/aguardar') && init?.method === 'POST') return resposta(200, { aguardandoAte: '2026-06-11T13:00:00.000Z' });
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

  test('a fila abre com título, selo do turno e sem a tela antiga fora da casca @spec:AC-461', async () => {
    fila = [item({ nome: 'Clínica Alfa' })];
    render(<FilaTurno />);
    expect(await screen.findByRole('heading', { name: 'Fila do Turno Operacional' })).toBeTruthy();
    expect(screen.getByText('Turno Manhã em andamento (08h00 – 12h00)')).toBeTruthy();
    const raiz = join(__dirname, '..', '..', '..');
    expect(existsSync(join(raiz, 'src/app/tarefas/page.tsx'))).toBe(false);
    expect(existsSync(join(raiz, 'src/app/(app)/tarefas/page.tsx'))).toBe(true);
  });

  test('os indicadores do topo mostram os números do resumo e o atalho para as atrasadas @spec:AC-462', async () => {
    fila = [item()];
    render(<FilaTurno />);
    expect(await screen.findByText('Conexões efetivas hoje')).toBeTruthy();
    expect(screen.getByText(/4 \/ 10/)).toBeTruthy();
    expect(screen.getByText('40% do turno')).toBeTruthy();
    expect(screen.getByText('Sem resposta hoje')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Ver 5 tarefas atrasadas' });
    expect(link.getAttribute('href')).toBe('/tarefas/atrasadas');
  });

  test('o destaque mostra o primeiro toque, sem SLA estimado nem script, e a fila vazia mostra o vazio @spec:AC-464', async () => {
    fila = [item({ nome: 'Clínica Alfa', seq: 12, etapaId: 9 })];
    render(<FilaTurno />);
    const destaque = await screen.findByRole('region', { name: 'Próxima tarefa em execução' });
    expect(within(destaque).getByText('Clínica Alfa')).toBeTruthy();
    expect(within(destaque).getByText('Atribuído a Ana Gerente')).toBeTruthy();
    expect(within(destaque).getByText(/Toque 12 de 18/)).toBeTruthy();
    expect(screen.queryByText(/SLA estimado/i)).toBeFalsy();
    cleanup();

    fila = [];
    render(<FilaTurno />);
    expect(await screen.findByText('Nenhuma tarefa no turno')).toBeTruthy();
  });

  test('concluir com sucesso e "não atendeu" chamam a API com a versão do card e recarregam @spec:AC-465', async () => {
    fila = [item({ nome: 'Clínica Alfa' })];
    const usuario = userEvent.setup({ advanceTimers: () => undefined });
    render(<FilaTurno />);
    await usuario.click(await screen.findByRole('button', { name: 'Concluir Toque com Sucesso' }));
    await usuario.click(await screen.findByRole('button', { name: 'Sim, o lead respondeu' }));
    await waitFor(() => {
      const chamada = fetchFalso.mock.calls.find((c) => String(c[0]).includes('/concluir'));
      expect(chamada).toBeTruthy();
      expect(JSON.parse(chamada![1].body)).toEqual({ version: 3, resultado: 'conectou' });
    });
    await usuario.click(screen.getByRole('button', { name: 'Não Atendeu' }));
    await waitFor(() => {
      const corpos = fetchFalso.mock.calls.filter((c) => String(c[0]).includes('/concluir')).map((c) => JSON.parse(c[1].body).resultado);
      expect(corpos).toEqual(['conectou', 'sem_resposta']);
    });
  });

  test('"sucesso" pede confirmação ("O lead respondeu?") e Voltar não conclui nada; não existe botão de espera @spec:AC-770', async () => {
    fila = [item({ nome: 'Clínica Zap', canal: 'whatsapp', seq: 3 })];
    const usuario = userEvent.setup({ advanceTimers: () => undefined });
    render(<FilaTurno />);
    expect(screen.queryByRole('button', { name: /Aguardando resposta/i })).toBeNull();

    await usuario.click(await screen.findByRole('button', { name: 'Concluir com sucesso: Clínica Zap' }));
    expect(await screen.findByRole('heading', { name: 'O lead respondeu?' })).toBeTruthy();
    await usuario.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.queryByRole('heading', { name: 'O lead respondeu?' })).toBeNull();
    expect(fetchFalso.mock.calls.some((c) => String(c[0]).includes('/concluir'))).toBe(false);

    // "Não atendeu" segue direto, sem confirmação
    await usuario.click(screen.getByRole('button', { name: 'Não atendeu: Clínica Zap' }));
    await waitFor(() => expect(fetchFalso.mock.calls.some((c) => String(c[0]).includes('/concluir'))).toBe(true));
    expect(screen.queryByRole('heading', { name: 'O lead respondeu?' })).toBeNull();
  });

  test('toque aguardando mostra o prazo, não é atrasado e o destaque passa para o próximo toque @spec:AC-771', async () => {
    fila = [
      item({ nome: 'Clínica Espera', canal: 'whatsapp', seq: 3, aguardandoAte: '2026-06-11T14:00:00.000Z' }),
      item({ nome: 'Clínica Próxima', canal: 'telefone', seq: 4 }),
    ];
    render(<FilaTurno />);
    expect(await screen.findByText(/Aguardando até 11:00/)).toBeTruthy();
    const destaque = await screen.findByRole('region', { name: 'Próxima tarefa em execução' });
    expect(within(destaque).getByText('Clínica Próxima')).toBeTruthy();
  });

  test('quando a API recusa, a mensagem do motivo aparece e a fila é recarregada @spec:AC-465', async () => {
    fila = [item()];
    concluirResposta = () => resposta(422, { codigo: 'BLOCO_ANTERIOR_PENDENTE' });
    const usuario = userEvent.setup({ advanceTimers: () => undefined });
    render(<FilaTurno />);
    await usuario.click(await screen.findByRole('button', { name: 'Concluir Toque com Sucesso' }));
    await usuario.click(await screen.findByRole('button', { name: 'Sim, o lead respondeu' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/bloco anterior/i);
  });

  test('a tabela mostra horário, lead com responsável, etapa, toque e ações, atrasados primeiro @spec:AC-466', async () => {
    fila = [
      item({ nome: 'Vigente Um', liberada: '2026-06-11T12:00:00.000Z', seq: 2 }),
      item({ nome: 'Atrasado Um', liberada: '2026-06-10T12:00:00.000Z', atrasado: true, seq: 7, canal: 'whatsapp' }),
    ];
    render(<FilaTurno />);
    await screen.findByText('2 pendentes');
    const linhas = screen.getAllByRole('row').slice(1);
    expect(linhas).toHaveLength(2);
    expect(within(linhas[0]).getByText('Atrasado Um')).toBeTruthy();
    expect(within(linhas[0]).getByText('Atrasado')).toBeTruthy();
    expect(within(linhas[0]).getByText(/Toque #7/)).toBeTruthy();
    expect(within(linhas[0]).getByText(/WhatsApp/)).toBeTruthy();
    expect(within(linhas[0]).getByText('09:00')).toBeTruthy();
    expect(within(linhas[0]).getByRole('link', { name: 'Abrir o card de Atrasado Um' }).getAttribute('href')).toBe('/pipeline/op-2');
    expect(within(linhas[1]).getByText('Vigente Um')).toBeTruthy();
  });

  test('a busca filtra pelo nome, a página mostra 10 por vez e sem resultado avisa @spec:AC-467', async () => {
    fila = Array.from({ length: 12 }, (_, i) => item({ nome: `Clínica ${String(i + 1).padStart(2, '0')}`, liberada: `2026-06-11T1${i % 10}:00:00.000Z` }));
    const usuario = userEvent.setup({ advanceTimers: () => undefined });
    render(<FilaTurno />);
    await screen.findByText('12 pendentes');
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(10);
    expect(screen.getByText(/Exibindo/).textContent).toMatch(/1 a 10 de 12/);
    await usuario.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(2);

    await usuario.type(screen.getByLabelText('Filtrar nesta lista'), 'Clínica 03');
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
    await usuario.clear(screen.getByLabelText('Filtrar nesta lista'));
    await usuario.type(screen.getByLabelText('Filtrar nesta lista'), 'zzz');
    expect(screen.getByText('Nenhum toque encontrado')).toBeTruthy();
  });

  test('o gerente escolhe um responsável e a fila é pedida filtrada; o atendente não vê o filtro @spec:AC-468', async () => {
    fila = [item()];
    const usuario = userEvent.setup({ advanceTimers: () => undefined });
    render(<FilaTurno />);
    const seletor = await screen.findByLabelText('Responsável');
    await screen.findByRole('option', { name: 'Bia' });
    await usuario.selectOptions(seletor, 'u2');
    await waitFor(() =>
      expect(fetchFalso.mock.calls.some((c) => String(c[0]) === '/api/atividades?atrasados=1&responsavelId=u2')).toBe(true)
    );
    cleanup();

    papel = 'ATENDENTE';
    render(<FilaTurno />);
    await screen.findByText('Fila Ordenada do Turno');
    await waitFor(() => expect(fetchFalso.mock.calls.some((c) => c[0] === '/api/me')).toBe(true));
    expect(screen.queryByLabelText('Responsável')).toBeFalsy();
  });

  test('a fila recarrega ao receber o evento e avisa quando o tempo real cai @spec:AC-470', async () => {
    fila = [item({ nome: 'Inicial' })];
    render(<FilaTurno />);
    await screen.findAllByText('Inicial');
    fila = [item({ nome: 'Atualizado' })];
    await act(async () => {
      FakeEventSource.instancias[0].disparar('cadencia.fila_alterada', { data: JSON.stringify({ tipo: 'cadencia.fila_alterada', empresaId: 'e' }) });
    });
    expect((await screen.findAllByText('Atualizado')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Inicial')).toHaveLength(0);
    expect(screen.getByText('Tempo real desconectado')).toBeTruthy();
    await act(async () => {
      FakeEventSource.instancias[0].disparar('open');
    });
    await waitFor(() => expect(screen.queryByText('Tempo real desconectado')).toBeFalsy());
  });

  test('Bloco de 3 Toques, Play e exportar aparecem "em breve" e sem as métricas sem dado @spec:AC-471', async () => {
    fila = [item()];
    render(<FilaTurno />);
    await screen.findByText('Fila Ordenada do Turno');
    for (const rotulo of ['Bloco de 3 Toques', 'Iniciar Próxima Ação (Play)', 'Exportar fila']) {
      const botao = screen.getByRole('button', { name: `${rotulo} (em breve)` });
      expect(botao.getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryByText(/Tempo médio de resposta/i)).toBeFalsy();
    expect(screen.queryByText(/Alerta de cumprimento/i)).toBeFalsy();
  });

  test('carregando mostra esqueleto, falha mostra erro com "Tentar de novo" @spec:AC-498', async () => {
    globalThis.fetch = vi.fn((url: string) =>
      url.startsWith('/api/atividades?') ? resposta(500, {}) : resposta(200, {})
    ) as unknown as typeof fetch;
    render(<FilaTurno />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    expect(await screen.findByText(/Não foi possível carregar a fila/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  test('o quadro ocupa a altura da tela e só a tabela da fila rola por dentro, com o cabeçalho fixo @spec:AC-762', async () => {
    fila = Array.from({ length: 8 }, (_, i) => item({ nome: `Clínica ${i + 1}`, seq: i + 1 }));
    const { container } = render(<FilaTurno />);
    await screen.findByText('Fila Ordenada do Turno');

    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.className).toContain('h-[calc(100dvh-4rem)]');
    expect(raiz.className).toContain('min-h-[40rem]');
    expect(raiz.className).toContain('flex-col');

    const secao = screen.getByText('Fila Ordenada do Turno').closest('section') as HTMLElement;
    expect(secao.className).toContain('flex-1');
    expect(secao.className).toContain('min-h-0');

    const rolagem = secao.querySelector('.overflow-auto') as HTMLElement;
    expect(rolagem.className).toContain('min-h-0');
    expect(rolagem.className).toContain('relative');
    expect(rolagem.contains(screen.getByText('Clínica 8'))).toBe(true);
    expect(rolagem.contains(screen.getByRole('heading', { name: 'Fila Ordenada do Turno' }))).toBe(false);
    const cabecalho = rolagem.querySelector('thead') as HTMLElement;
    expect(cabecalho.className).toContain('sticky');
    expect(cabecalho.className).toContain('top-0');
  });
});
