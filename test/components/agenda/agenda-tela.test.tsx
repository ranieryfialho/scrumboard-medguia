// T-186 (fase4-tarefas-agenda, US-121/US-122): a tela da agenda
// (src/components/agenda/agenda-tela.tsx) — título, indicadores, quatro visões,
// filtros, fila de hoje, lateral, itens "em breve" e ações. Relógio fixado em
// quinta-feira, 11/06/2026, 11h em São Paulo.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AgendaTela } from '../../../src/components/agenda/agenda-tela';
import { diaDe } from '../../../src/components/agenda/datas';

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

function r(id: string, nome: string, quando: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    oportunidadeId: `op-${id}`,
    agendadaPara: quando,
    status,
    encerradaEm: null,
    noShow: status === 'no_show',
    resumo: null,
    anexoId: null,
    remarcadaDe: null,
    lead: { id: `l-${id}`, nome, telefoneE164: null },
    valor: '14800',
    etapaId: 8,
    version: 1,
    closer: { id: 'u2', nome: 'Bia' },
    ...extra,
  };
}

const REUNIOES = [
  r('a', 'Lead A', '2026-06-11T15:00:00Z', 'agendada'),
  r('b', 'Lead B', '2026-06-11T13:30:00Z', 'em_andamento'),
  r('c', 'Lead C', '2026-06-11T11:00:00Z', 'aguardando_resultado'),
  r('d', 'Lead D', '2026-06-11T09:00:00Z', 'realizada', { resumo: 'Ótima reunião', anexoId: 'an-1' }),
  r('g', 'Lead G', '2026-06-11T08:00:00Z', 'no_show'),
  r('e', 'Lead E', '2026-06-10T13:00:00Z', 'no_show'),
  r('f', 'Lead F', '2026-06-12T13:00:00Z', 'agendada'),
];

const RESUMO = {
  hoje: { total: 5, emAndamentoOuPorVir: 2 },
  presenca: { taxa: 33, realizadas: 1, noShows: 2 },
  noShow: { quantidade: 2, percentual: 67 },
  pipelineEmDemonstracao: { valor: 68200, contas: 5 },
  resgateDeNoShows: [{ reuniaoId: 'g', oportunidadeId: 'op-g', leadNome: 'Dra. Regina Toledo', agendadaPara: '2026-06-11T08:00:00Z', closer: { id: 'u2', nome: 'Bia' } }],
  desempenhoPorCloser: [{ closerId: 'u2', nome: 'Bia', realizadas: 12, comResultado: 13, taxa: 92 }],
};

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

describe('T-186: AgendaTela', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let papel: string;
  let falharLista: boolean;

  const urlsDaLista = () => fetchFalso.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/reunioes?'));
  const ultimaUrl = () => urlsDaLista().at(-1)!;

  beforeEach(() => {
    FakeEventSource.instancias = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-11T14:00:00Z'));
    papel = 'GERENTE';
    falharLista = false;
    fetchFalso = vi.fn((url: string, init?: { method?: string }) => {
      if (url.startsWith('/api/reunioes?')) {
        if (falharLista) return resposta(500, {});
        const p = new URL(url, 'http://x').searchParams;
        const itens = REUNIOES.filter((x) => diaDe(x.agendadaPara) >= p.get('de')! && diaDe(x.agendadaPara) <= p.get('ate')!)
          .filter((x) => !p.get('status') || x.status === p.get('status'))
          .filter((x) => !p.get('closerId') || x.closer.id === p.get('closerId'));
        return resposta(200, { reunioes: itens });
      }
      if (url === '/api/reunioes/resumo') return resposta(200, RESUMO);
      if (url === '/api/me') return resposta(200, { papel, isSuperAdmin: false });
      if (url === '/api/pipeline/responsaveis') return resposta(200, { responsaveis: [{ id: 'u1', nome: 'Ana' }, { id: 'u2', nome: 'Bia' }] });
      if (url.includes('/no-show') && init?.method === 'POST') return resposta(200, {});
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

  const usuario = () => userEvent.setup({ advanceTimers: () => undefined });

  test('a agenda abre com o título dentro do grupo (app) e a semana atual @spec:AC-480', async () => {
    render(<AgendaTela />);
    expect(await screen.findByRole('heading', { name: 'Agenda de Reuniões Comerciais e No-Show' })).toBeTruthy();
    expect(screen.getByText('8 a 14 de junho de 2026')).toBeTruthy();
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/agenda/page.tsx'))).toBe(true);
  });

  test('os indicadores da semana vêm do resumo, sem MRR nem metas @spec:AC-483', async () => {
    render(<AgendaTela />);
    await screen.findByText('Reuniões agendadas hoje');
    expect(screen.getByText('2 em andamento / próximas')).toBeTruthy();
    expect(screen.getByText('33%')).toBeTruthy();
    expect(screen.getByText('Ocorrências de no-show')).toBeTruthy();
    expect(screen.getByText('67% na semana')).toBeTruthy();
    expect(screen.getByText(/68\.200/)).toBeTruthy();
    expect(screen.getByText('5 contas')).toBeTruthy();
    expect(screen.queryByText(/MRR/)).toBeFalsy();
    expect(screen.queryByText(/Meta/)).toBeFalsy();
  });

  test('alterna entre Lista, Dia, Semana e Mês e pede só o período visível @spec:AC-484', async () => {
    const u = usuario();
    render(<AgendaTela />);
    await screen.findByText('Semana', { selector: '[role="tab"]' });
    await waitFor(() => expect(urlsDaLista().some((x) => x.startsWith('/api/reunioes?de=2026-06-08&ate=2026-06-14'))).toBe(true));
    expect(document.querySelector('[data-visao="semana"]')).toBeTruthy();

    await u.click(screen.getByRole('tab', { name: 'Dia' }));
    await waitFor(() => expect(ultimaUrl()).toMatch(/de=2026-06-11&ate=2026-06-11/));
    await u.click(screen.getByRole('button', { name: 'Próximo período' }));
    await waitFor(() => expect(ultimaUrl()).toMatch(/de=2026-06-12&ate=2026-06-12/));
    expect(await screen.findByText('12 de junho de 2026', { selector: '[aria-live]' })).toBeTruthy();
    expect((await screen.findAllByLabelText('Reunião com Lead F')).length).toBe(1);
    await u.click(screen.getByRole('button', { name: 'Hoje' }));
    await waitFor(() => expect(ultimaUrl()).toMatch(/de=2026-06-11&ate=2026-06-11/));

    await u.click(screen.getByRole('tab', { name: 'Lista' }));
    await waitFor(() => expect(ultimaUrl()).toMatch(/de=2026-06-08&ate=2026-06-14/));
    expect(await screen.findByText('10 de junho de 2026')).toBeTruthy();

    await u.click(screen.getByRole('tab', { name: 'Mês' }));
    await waitFor(() => expect(ultimaUrl()).toMatch(/de=2026-06-01&ate=2026-07-12/));
    const dia11 = await screen.findByRole('button', { name: '11 de junho de 2026, 5 reuniões' });
    await u.click(dia11);
    expect(screen.getByRole('tab', { name: 'Dia' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(ultimaUrl()).toMatch(/de=2026-06-11&ate=2026-06-11/));
  });

  test('a taxa de presença mostra a meta e "Meta atingida" quando alcança @spec:AC-622', async () => {
    const base = fetchFalso.getMockImplementation()!;
    fetchFalso.mockImplementation((url: string, init?: { method?: string }) =>
      url === '/api/metas' ? resposta(200, { metas: { taxa_presenca: 1 }, detalhes: [] }) : base(url, init)
    );
    render(<AgendaTela />);
    expect(await screen.findByText('Meta 1%')).toBeTruthy();
    expect(screen.getByText('Meta atingida')).toBeTruthy();
    cleanup();

    fetchFalso.mockImplementation((url: string, init?: { method?: string }) =>
      url === '/api/metas' ? resposta(200, { metas: { taxa_presenca: 100 }, detalhes: [] }) : base(url, init)
    );
    render(<AgendaTela />);
    expect(await screen.findByText('Meta 100%')).toBeTruthy();
    expect(screen.queryByText('Meta atingida')).toBeNull();
  });

  test('os filtros por closer e por status restringem a lista e Limpar volta ao completo @spec:AC-485', async () => {
    const u = usuario();
    render(<AgendaTela />);
    await screen.findByRole('option', { name: 'Bia' });
    await u.selectOptions(screen.getByLabelText('Closer'), 'u2');
    await waitFor(() => expect(ultimaUrl()).toMatch(/closerId=u2/));
    await u.selectOptions(screen.getByLabelText('Status'), 'no_show');
    await waitFor(() => expect(ultimaUrl()).toMatch(/closerId=u2&status=no_show/));
    await u.click(screen.getByRole('button', { name: 'Limpar' }));
    await waitFor(() => expect(ultimaUrl()).not.toMatch(/closerId|status=/));
    // os indicadores seguem os da semana inteira (nunca pedem o filtro)
    expect(fetchFalso.mock.calls.filter((c) => c[0] === '/api/reunioes/resumo').length).toBeGreaterThan(0);
  });

  test('a fila de hoje mostra horário, lead, valor, closer, status e a evidência, sem campos que não existem @spec:AC-486', async () => {
    render(<AgendaTela />);
    const fila = await screen.findByRole('region', { name: 'Fila de Reuniões e Sessões Clínicas (Hoje)' });
    await within(fila).findByLabelText('Reunião com Lead D');
    expect(within(fila).getAllByRole('article')).toHaveLength(5);
    const cartaoD = within(fila).getByLabelText('Reunião com Lead D');
    expect(within(cartaoD).getByText('06:00')).toBeTruthy();
    expect(within(cartaoD).getByText('Realizada')).toBeTruthy();
    expect(within(cartaoD).getByText(/14\.800/)).toBeTruthy();
    expect(within(cartaoD).getByText('Closer: Bia')).toBeTruthy();
    expect(within(cartaoD).getByText('Ótima reunião')).toBeTruthy();
    expect(within(cartaoD).getByRole('link', { name: 'Abrir evidência' }).getAttribute('href')).toBe('/api/anexos/an-1');
    expect(within(fila).queryByText(/Participantes|Objetivo|Canal:|SDR/)).toBeFalsy();
    // cada status só oferece as ações que permite
    expect(within(within(fila).getByLabelText('Reunião com Lead A')).queryByRole('button', { name: /Registrar No-Show/ })).toBeFalsy();
    expect(within(within(fila).getByLabelText('Reunião com Lead B')).getByRole('button', { name: /Marcar como Concluída/ })).toBeTruthy();
    expect(within(within(fila).getByLabelText('Reunião com Lead D')).queryByRole('button', { name: /Reagendar/ })).toBeFalsy();
  });

  test('a lateral mostra o resgate de no-shows com Reagendar e o desempenho por closer @spec:AC-487', async () => {
    const u = usuario();
    render(<AgendaTela />);
    const resgate = await screen.findByRole('region', { name: 'Fila de Resgate de No-Shows' });
    expect(within(resgate).getByText('Dra. Regina Toledo')).toBeTruthy();
    expect(within(resgate).getByText('1 pendentes')).toBeTruthy();
    const desempenho = screen.getByRole('region', { name: 'Performance por Closer' });
    expect(within(desempenho).getByText('92% (12/13)')).toBeTruthy();
    await u.click(within(resgate).getByRole('button', { name: 'Reagendar no-show: Dra. Regina Toledo' }));
    expect(await screen.findByRole('heading', { name: 'Reagendar Reunião' })).toBeTruthy();
  });

  test('Cancelar pede confirmação, chama a API e recarrega; sem confirmar não faz nada; a recusa aparece @spec:AC-643', async () => {
    const u = usuario();
    const base = fetchFalso.getMockImplementation()!;
    let resposta: Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> = Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    fetchFalso.mockImplementation((url: string, init?: { method?: string }) => (url.endsWith('/cancelar') ? resposta : base(url, init)));
    const confirmar = vi.spyOn(window, 'confirm');
    render(<AgendaTela />);
    const botao = await screen.findByRole('button', { name: 'Cancelar: Lead A' });

    confirmar.mockReturnValueOnce(false);
    await u.click(botao);
    expect(fetchFalso.mock.calls.some((c) => String(c[0]).endsWith('/cancelar'))).toBe(false);

    confirmar.mockReturnValue(true);
    await u.click(botao);
    expect(confirmar).toHaveBeenLastCalledWith(expect.stringContaining('Qualificado p/ reunião'));
    await waitFor(() => expect(fetchFalso.mock.calls.some((c) => c[0] === '/api/reunioes/a/cancelar' && c[1]?.method === 'POST')).toBe(true));

    resposta = Promise.resolve({ ok: false, status: 422, json: () => Promise.resolve({ codigo: 'REUNIAO_NAO_PODE_CANCELAR' }) });
    await u.click(await screen.findByRole('button', { name: 'Cancelar: Lead A' }));
    expect(await screen.findByText(/Só dá para cancelar uma reunião que ainda não aconteceu/)).toBeTruthy();
    confirmar.mockRestore();
  });

  test('"Ligar para Clínica" é um link tel: quando o lead tem telefone e some quando não tem @spec:AC-646', async () => {
    const base = fetchFalso.getMockImplementation()!;
    render(<AgendaTela />);
    await screen.findByLabelText('Reunião com Lead C');
    expect(screen.queryByText('Ligar para Clínica')).toBeNull();
    cleanup();

    fetchFalso.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.startsWith('/api/reunioes?')) {
        const c = r('c', 'Lead C', '2026-06-11T11:00:00Z', 'aguardando_resultado');
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reunioes: [{ ...c, lead: { ...c.lead, telefoneE164: '5511999990000' } }] }) });
      }
      return base(url, init);
    });
    render(<AgendaTela />);
    expect((await screen.findByRole('link', { name: 'Ligar para Clínica' })).getAttribute('href')).toBe('tel:+5511999990000');
  });

  test('o que não tem backend aparece "em breve" e o que não existe no sistema não aparece @spec:AC-488', async () => {
    render(<AgendaTela />);
    await screen.findByLabelText('Reunião com Lead D');
    for (const rotulo of [
      'Google Meet / Outlook',
      'Entrar no Meet Agora',
      'Transferir para Cadência de Resgate',
      'Disparar WhatsApp de Reagendamento',
      'Confirmar Manualmente',
      'Enviar Template Médico de Resgate',
    ]) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryByText(/Protocolo Anti-No-Show/)).toBeFalsy();
    expect(screen.queryByText(/aproveitamento de agenda/i)).toBeFalsy();
  });

  test('Registrar No-Show chama a API da reunião e relê a agenda @spec:AC-491', async () => {
    const u = usuario();
    render(<AgendaTela />);
    const botao = await screen.findByRole('button', { name: 'Registrar No-Show: Lead C' });
    const antes = urlsDaLista().length;
    await u.click(botao);
    await waitFor(() => expect(fetchFalso.mock.calls.some((c) => c[0] === '/api/reunioes/c/no-show' && c[1]?.method === 'POST')).toBe(true));
    await waitFor(() => expect(urlsDaLista().length).toBeGreaterThan(antes));
  });

  test('quando o funil muda, a agenda relê o período visível @spec:AC-495', async () => {
    render(<AgendaTela />);
    await screen.findByLabelText('Reunião com Lead D');
    const antes = urlsDaLista().length;
    await act(async () => {
      FakeEventSource.instancias[0].disparar('oportunidade.movida', {
        data: JSON.stringify({ empresaId: 'e', oportunidadeId: 'op-a', etapaOrigemId: 6, etapaDestinoId: 8, atorId: 'u1', ocorridoEm: '2026-06-11T14:00:00Z' }),
      });
    });
    await waitFor(() => expect(urlsDaLista().length).toBeGreaterThan(antes));
  });

  test('carregando mostra esqueleto, período sem reuniões mostra o vazio e falha mostra erro com "Tentar de novo" @spec:AC-498', async () => {
    const u = usuario();
    render(<AgendaTela />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByLabelText('Reunião com Lead D');
    await u.click(screen.getByRole('button', { name: 'Próximo período' }));
    await u.click(screen.getByRole('button', { name: 'Próximo período' }));
    await u.click(screen.getByRole('tab', { name: 'Lista' }));
    expect((await screen.findAllByText('Nenhuma reunião neste período')).length).toBeGreaterThan(0);
    cleanup();

    falharLista = true;
    render(<AgendaTela />);
    expect(await screen.findByText(/Não foi possível carregar a agenda/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  test('o topo segue o protótipo: trilha, cartões com selo e barra de progresso, contagem na aba Lista e o período com ícone @spec:AC-764', async () => {
    render(<AgendaTela />);
    await screen.findByText('Reuniões agendadas hoje');

    const trilha = screen.getByRole('navigation', { name: 'Trilha' });
    expect(within(trilha).getByText('Operação comercial')).toBeTruthy();
    expect(within(trilha).getByText('/agenda')).toBeTruthy();

    const cartao = (titulo: string) => screen.getByText(titulo).closest('div.rounded-2xl') as HTMLElement;
    const barra = (c: HTMLElement) => c.querySelector('[role="presentation"] > div') as HTMLElement | null;
    const hoje = cartao('Reuniões agendadas hoje');
    expect(within(hoje).getByText('Hoje')).toBeTruthy();
    expect(barra(hoje)!.style.width).toBe('60%'); // 5 reuniões, 2 por vir → 3 já passaram
    expect(barra(cartao('Taxa de presença'))!.style.width).toBe('33%');
    const noShow = cartao('Ocorrências de no-show');
    expect(within(noShow).getByText('clínicas')).toBeTruthy();
    expect(within(noShow).getByText('Atenção')).toBeTruthy();
    expect(barra(noShow)!.style.width).toBe('67%');
    expect(barra(cartao('Pipeline em demonstração'))).toBeNull(); // sem percentual natural, sem barra inventada

    // a aba Lista mostra quantas reuniões a semana tem, sem mudar o nome da aba
    const lista = screen.getByRole('tab', { name: 'Lista' });
    expect(lista.querySelector('[aria-hidden="true"]')!.textContent).toBe('7'); // as 7 reuniões da semana
    expect(screen.getByText('8 a 14 de junho de 2026').closest('span.border-l')!.querySelector('.material-symbols-outlined')!.textContent).toBe('calendar_month');
  });

  test('o cartão da fila tem faixa colorida pelo status, bloco de horário (com o fim quando a reunião terminou) e ícone no selo @spec:AC-764', async () => {
    const base = fetchFalso.getMockImplementation()!;
    fetchFalso.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.startsWith('/api/reunioes?') && url.includes('de=2026-06-11&ate=2026-06-11')) {
        return resposta(200, { reunioes: [r('d', 'Lead D', '2026-06-11T09:00:00Z', 'realizada', { encerradaEm: '2026-06-11T09:45:00Z' }), r('g', 'Lead G', '2026-06-11T08:00:00Z', 'no_show'), r('a', 'Lead A', '2026-06-11T15:00:00Z', 'agendada')] });
      }
      return base(url, init);
    });
    render(<AgendaTela />);
    const fila = await screen.findByRole('region', { name: 'Fila de Reuniões e Sessões Clínicas (Hoje)' });
    const d = await within(fila).findByLabelText('Reunião com Lead D');

    expect(d.className).toContain('border-success-text');
    expect(within(d).getByText('06:00')).toBeTruthy();
    expect(within(d).getByText('06:45')).toBeTruthy(); // o fim só aparece quando a reunião terminou de fato
    expect(within(d).getByText('Realizada').querySelector('[data-icone-do-status]')!.textContent).toBe('check_circle');

    const g = within(fila).getByLabelText('Reunião com Lead G');
    expect(g.className).toContain('border-danger-text');
    expect(within(g).queryByText('06:45')).toBeNull();
    expect(within(fila).getByLabelText('Reunião com Lead A').className).toContain('border-primary');

    // nas células apertadas da semana o selo é só texto
    const semana = document.querySelector('[data-visao="semana"]') as HTMLElement;
    expect(semana.querySelector('[data-icone-do-status]')).toBeNull();
  });

  test('a performance por closer pinta a barra pela taxa: verde, azul ou âmbar @spec:AC-764', async () => {
    const base = fetchFalso.getMockImplementation()!;
    fetchFalso.mockImplementation((url: string, init?: { method?: string }) =>
      url === '/api/reunioes/resumo'
        ? resposta(200, {
            ...RESUMO,
            desempenhoPorCloser: [
              { closerId: 'a', nome: 'Alta', realizadas: 12, comResultado: 13, taxa: 92 },
              { closerId: 'b', nome: 'Média', realizadas: 7, comResultado: 8, taxa: 85 },
              { closerId: 'c', nome: 'Baixa', realizadas: 6, comResultado: 8, taxa: 75 },
            ],
          })
        : base(url, init)
    );
    render(<AgendaTela />);
    const desempenho = await screen.findByRole('region', { name: 'Performance por Closer' });
    const cor = (nome: string) => (within(desempenho).getByText(nome).closest('div.flex-col') as HTMLElement).querySelector('.h-full')!.className;
    expect(cor('Alta')).toContain('bg-success-text');
    expect(cor('Média')).toContain('bg-primary');
    expect(cor('Baixa')).toContain('bg-warning-text');
  });
});
