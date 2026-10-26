// Testes de T-097 (fase2b-fila-tarefas, US-056/US-058/US-060): a tela
// "Minhas tarefas" (src/components/tarefas/fila-tarefas.tsx) e o item de
// menu que leva até ela (src/components/layout/sidebar.tsx). Mesmo molde de
// test/sse/board-evento.test.tsx (fetch falso + `FakeEventSource`, jsdom não
// implementa `EventSource`), com dois mocks extras porque o `Sidebar` ainda
// é código legado (Supabase Auth, não Better Auth): `@/lib/supabase/client`
// (evita `createBrowserClient` reclamar de faltar `NEXT_PUBLIC_SUPABASE_URL`
// em teste) e `next/navigation` (`useRouter` exige um app router de
// verdade). AC-204 também cobre o redirecionamento "sem sessão" executando
// de fato `src/middleware.ts` contra `/tarefas` — é o mesmo portão que já
// protege `/pipeline` e todo o resto do app (nenhuma linha nova nele por
// esta tarefa), só provado aqui porque é a primeira vez que uma spec
// referencia esse comportamento.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextRequest } from 'next/server';

// O middleware (T-143, fase4) decide pela sessão do Better Auth: aqui o teste só
// precisa de "sem sessão" para checar o redirecionamento ao login, sem banco
// (a prova com Postgres real dessa regra é test/auth/middleware.test.ts, AC-379).
vi.mock('@/lib/auth/instancia', () => ({
  getAuth: () => ({ api: { getSession: async () => null } }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
      signOut: async () => {},
    },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { middleware } from '../../../src/middleware';
import { Sidebar } from '../../../src/components/layout/sidebar';
import { FilaTarefas } from '../../../src/components/tarefas/fila-tarefas';

type Ouvinte = (evento: unknown) => void;

// Mesmo fake de test/sse/board-evento.test.tsx: jsdom não implementa `EventSource`.
class FakeEventSource {
  static instancias: FakeEventSource[] = [];

  url: string;
  private ouvintes = new Map<string, Set<Ouvinte>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instancias.push(this);
  }

  addEventListener(tipo: string, ouvinte: Ouvinte): void {
    if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, new Set());
    this.ouvintes.get(tipo)!.add(ouvinte);
  }

  removeEventListener(tipo: string, ouvinte: Ouvinte): void {
    this.ouvintes.get(tipo)?.delete(ouvinte);
  }

  close(): void {}

  disparar(tipo: string, evento: unknown = {}): void {
    for (const ouvinte of this.ouvintes.get(tipo) ?? []) ouvinte(evento);
  }
}

let contador = 0;

function itemFila(
  overrides: Partial<{
    sequencia: number;
    canal: 'telefone' | 'whatsapp';
    tipo: 'ligacao' | 'mensagem' | 'breakup';
    atrasado: boolean;
    oportunidadeId: string;
    leadId: string;
    leadNome: string;
  }> = {}
) {
  contador += 1;
  const oportunidadeId = overrides.oportunidadeId ?? `op-${contador}`;
  const leadId = overrides.leadId ?? `lead-${contador}`;
  return {
    atividade: {
      id: `atividade-${contador}`,
      sequencia: overrides.sequencia ?? 1,
      canal: overrides.canal ?? 'telefone',
      tipo: overrides.tipo ?? 'ligacao',
    },
    oportunidade: { id: oportunidadeId },
    lead: { id: leadId, nome: overrides.leadNome ?? `Lead ${contador}`, telefoneE164: null },
    atrasado: overrides.atrasado ?? false,
  };
}

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

describe('T-097: FilaTarefas e menu de /tarefas', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let filaAtual: ReturnType<typeof itemFila>[];
  let rotasExtras: Record<string, unknown>;

  beforeEach(() => {
    contador = 0;
    FakeEventSource.instancias = [];
    vi.stubGlobal('EventSource', FakeEventSource);

    filaAtual = [];
    rotasExtras = {};
    fetchFalso = vi.fn((url: string) => {
      if (url === '/api/atividades?atrasados=1') return resposta(200, { itens: filaAtual });
      if (url in rotasExtras) return resposta(200, rotasExtras[url]);
      return resposta(404, { codigo: 'NAO_ENCONTRADO' });
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    globalThis.fetch = fetchOriginal;
  });

  function mockFetchFila(itens: ReturnType<typeof itemFila>[], extras: Record<string, unknown> = {}) {
    filaAtual = itens;
    rotasExtras = extras;
  }

  describe('AC-204: a página exige login e tem um item no menu lateral', () => {
    test('o menu lateral mostra "Minhas tarefas" levando a /tarefas @spec:AC-204', () => {
      render(<Sidebar abaAtiva="dashboard" setAbaAtiva={() => {}} />);

      const link = screen.getByRole('link', { name: /minhas tarefas/i });
      expect(link.getAttribute('href')).toBe('/tarefas');
    });

    // `NextRequest`/`NextResponse` constroem seus próprios `Headers` (não o
    // `globalThis.Headers` do jsdom deste arquivo); `vi.stubGlobal` troca o
    // `Headers` global pelo mesmo usado internamente pela requisição, só
    // pra esta chamada — sem isso, `NextResponse.next` do próprio
    // `src/middleware.ts` rejeita com "request.headers must be an instance
    // of Headers" por engano de realm, não por causa do que estamos testando.
    test('sem sessão, o acesso a /tarefas é redirecionado para o login @spec:AC-204', async () => {
      const requisicao = new NextRequest('http://localhost/tarefas');
      vi.stubGlobal('Headers', requisicao.headers.constructor);

      const resposta = await middleware(requisicao);

      expect(resposta.status).toBe(307);
      const destino = new URL(resposta.headers.get('location') ?? '', 'http://localhost');
      expect(destino.pathname).toBe('/login');
    });
  });

  describe('AC-205: cada toque mostra o lead, o canal e a posição na cadência', () => {
    test('mostra o nome do lead, canal, tipo e "toque N de 18" @spec:AC-205', async () => {
      mockFetchFila([itemFila({ sequencia: 5, canal: 'telefone', tipo: 'ligacao', leadNome: 'Maria Souza' })]);
      render(<FilaTarefas />);

      await screen.findByText('Maria Souza');
      expect(screen.getByText(/Telefone/)).toBeTruthy();
      expect(screen.getByText(/Ligação/)).toBeTruthy();
      expect(screen.getByText(/toque 5 de 18/)).toBeTruthy();
    });

    test('toque de WhatsApp e mensagem mostra "WhatsApp" e "Mensagem" @spec:AC-205', async () => {
      mockFetchFila([itemFila({ sequencia: 11, canal: 'whatsapp', tipo: 'mensagem', leadNome: 'Carlos Lima' })]);
      render(<FilaTarefas />);

      await screen.findByText('Carlos Lima');
      expect(screen.getByText(/WhatsApp/)).toBeTruthy();
      expect(screen.getByText(/Mensagem/)).toBeTruthy();
      expect(screen.getByText(/toque 11 de 18/)).toBeTruthy();
    });
  });

  describe('AC-206: fila vazia explica o motivo', () => {
    test('dentro do turno, sem toques pendentes, explica "sem toques neste turno" @spec:AC-206', async () => {
      // 2026-06-11 é quinta-feira útil, 09h local — dentro do turno da manhã
      // (mesma data de referência de test/api/atividades.test.ts).
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-11T09:00:00-03:00'));

      mockFetchFila([]);
      render(<FilaTarefas />);

      expect(await screen.findByText(/nenhum toque pendente neste turno/i)).toBeTruthy();
      expect(screen.queryByText(/fora do horário de atendimento/i)).toBeFalsy();
    });

    test('fora do horário de atendimento (fim de semana) explica o motivo distinto @spec:AC-206', async () => {
      // 2026-06-13 é sábado.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-13T10:00:00-03:00'));

      mockFetchFila([]);
      render(<FilaTarefas />);

      expect(await screen.findByText(/fora do horário de atendimento/i)).toBeTruthy();
      expect(screen.queryByText(/nenhum toque pendente neste turno\./i)).toBeFalsy();
    });
  });

  describe('AC-207: cada toque leva ao card e, se for WhatsApp, à conversa', () => {
    test('clicar no lead leva ao detalhe do card (/pipeline/:id) @spec:AC-207', async () => {
      mockFetchFila([itemFila({ canal: 'telefone', oportunidadeId: 'op-joao', leadNome: 'João' })]);
      render(<FilaTarefas />);

      const link = await screen.findByRole('link', { name: 'João' });
      expect(link.getAttribute('href')).toBe('/pipeline/op-joao');
    });

    test('toque de telefone não mostra o atalho da conversa @spec:AC-207', async () => {
      mockFetchFila([itemFila({ canal: 'telefone', leadNome: 'Sem WhatsApp' })]);
      render(<FilaTarefas />);

      await screen.findByText('Sem WhatsApp');
      expect(screen.queryByRole('button', { name: 'Abrir conversa' })).toBeFalsy();
    });

    test('toque de WhatsApp mostra "Abrir conversa" e abre a conversa do lead @spec:AC-207', async () => {
      mockFetchFila([itemFila({ canal: 'whatsapp', leadId: 'lead-ana', leadNome: 'Ana' })], {
        '/api/whatsapp/messages?leadId=lead-ana': {
          mensagens: [{ mensagem: 'Oi, tudo bem?', direcao: 'recebida', created_at: '2026-06-11T09:00:00.000Z' }],
        },
      });
      render(<FilaTarefas />);

      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Abrir conversa' }));

      expect(await screen.findByText('Conversa com Ana')).toBeTruthy();
      expect(await screen.findByText('Oi, tudo bem?')).toBeTruthy();
    });
  });

  describe('AC-213: a tela destaca os atrasados em uma seção própria', () => {
    test('atrasados aparecem numa seção "Atrasadas" acima do turno vigente, com o selo "Atrasado" @spec:AC-213', async () => {
      mockFetchFila([
        itemFila({ atrasado: true, leadNome: 'Atrasado Um', sequencia: 2 }),
        itemFila({ atrasado: false, leadNome: 'Vigente Um', sequencia: 7 }),
      ]);
      render(<FilaTarefas />);

      await screen.findByText('Atrasado Um');
      await screen.findByText('Vigente Um');

      const titulos = screen.getAllByRole('heading').map((titulo) => titulo.textContent);
      expect(titulos.indexOf('Atrasadas')).toBeGreaterThanOrEqual(0);
      expect(titulos.indexOf('Atrasadas')).toBeLessThan(titulos.indexOf('Turno vigente'));

      // Só o item atrasado mostra o selo.
      expect(screen.getAllByText('Atrasado')).toHaveLength(1);
      const linhaAtrasada = screen.getByText('Atrasado Um').closest('div')!.parentElement!.parentElement!;
      expect(within(linhaAtrasada).getByText('Atrasado')).toBeTruthy();

      // Mesma estrutura de link pro card nos dois casos — nada bloqueia a
      // conclusão do atrasado "como os demais" (os botões vêm em T-098).
      const linkAtrasado = screen.getByRole('link', { name: 'Atrasado Um' });
      const linkVigente = screen.getByRole('link', { name: 'Vigente Um' });
      expect(linkAtrasado.tagName).toBe(linkVigente.tagName);
      expect(linkAtrasado.getAttribute('href')).toMatch(/^\/pipeline\//);
      expect(linkVigente.getAttribute('href')).toMatch(/^\/pipeline\//);
    });
  });

  describe('AC-219: a página recarrega a fila ao receber o evento, com fallback', () => {
    test('recarrega ao receber cadencia.fila_alterada e stream.reconectado, sem duplicar itens @spec:AC-219', async () => {
      mockFetchFila([itemFila({ leadNome: 'Inicial' })]);
      render(<FilaTarefas />);
      await screen.findByText('Inicial');

      mockFetchFila([itemFila({ leadNome: 'Atualizado' })]);
      const origem = FakeEventSource.instancias[0];
      origem.disparar('cadencia.fila_alterada', {
        data: JSON.stringify({ empresaId: 'empresa-1', oportunidadeId: 'op-1' }),
      });

      await waitFor(() => expect(screen.queryByText('Inicial')).toBeFalsy());
      expect(await screen.findByText('Atualizado')).toBeTruthy();
      // O próprio disparo não duplica o item recarregado.
      expect(screen.getAllByText('Atualizado')).toHaveLength(1);

      mockFetchFila([itemFila({ leadNome: 'Reconectado' })]);
      origem.disparar('stream.reconectado', {});

      expect(await screen.findByText('Reconectado')).toBeTruthy();
      expect(screen.queryByText('Atualizado')).toBeFalsy();
    });

    test('ao cair para o polling de fallback, a fila também recarrega @spec:AC-219', async () => {
      mockFetchFila([itemFila({ leadNome: 'Inicial' })]);
      render(<FilaTarefas />);
      await screen.findByText('Inicial');

      const chamadasAntes = fetchFalso.mock.calls.filter(
        (chamada) => chamada[0] === '/api/atividades?atrasados=1'
      ).length;

      mockFetchFila([itemFila({ leadNome: 'Via Polling' })]);
      const origem = FakeEventSource.instancias[0];
      origem.disparar('error', {});
      origem.disparar('error', {});
      origem.disparar('error', {});

      expect(await screen.findByText('Via Polling')).toBeTruthy();
      const chamadasDepois = fetchFalso.mock.calls.filter(
        (chamada) => chamada[0] === '/api/atividades?atrasados=1'
      ).length;
      expect(chamadasDepois).toBeGreaterThan(chamadasAntes);
    });
  });
});
