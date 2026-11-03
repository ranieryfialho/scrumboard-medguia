// @vitest-environment jsdom
//
// Testes de T-146 (fase4-design-system-shell-acesso, US-098): a casca das
// telas logadas — menu lateral (src/components/shell/menu-lateral.tsx),
// topo (src/components/shell/topo.tsx) e o layout que os compõe
// (src/app/(app)/layout.tsx). Mesmo molde de test/sse/use-stream.test.tsx
// (FakeEventSource — jsdom não implementa `EventSource`) e de
// test/components/tarefas/fila-tarefas.test.tsx (fetch falso por rota,
// `next/navigation` mockado — `usePathname`/`useRouter` exigem um app
// router de verdade que não existe em teste).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import packageJson from '../../../package.json';

const pushMock = vi.fn();
const refreshMock = vi.fn();
let pathnameAtual = '/pipeline';

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameAtual,
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { MenuLateral } from '@/components/shell/menu-lateral';
import { Topo, type UsuarioSessao } from '@/components/shell/topo';
import AppLayout from '@/app/(app)/layout';

type Ouvinte = (evento: unknown) => void;

// Mesmo fake de test/sse/use-stream.test.tsx: jsdom não implementa `EventSource`.
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

  close(): void {}

  disparar(tipo: string, evento: unknown = {}): void {
    for (const ouvinte of this.ouvintes.get(tipo) ?? []) ouvinte(evento);
  }
}

interface RotaFalsa {
  status?: number;
  corpo?: unknown;
}

const fetchOriginal = globalThis.fetch;

/** Fetch falso por prefixo de rota — mesmo molde de test/components/tarefas/fila-tarefas.test.tsx. */
function instalarFetchFalso(rotas: Record<string, RotaFalsa>) {
  const fetchFalso = vi.fn((entrada: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada.toString();
    const chave = Object.keys(rotas).find((rota) => url.startsWith(rota));
    const { status = 200, corpo = {} } = chave ? rotas[chave] : { status: 404, corpo: { codigo: 'NAO_ENCONTRADO' } };
    return Promise.resolve({
      ok: status < 400,
      status,
      json: async () => corpo,
    } as Response);
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
  return fetchFalso;
}

function usuarioBase(sobrescritas: Partial<UsuarioSessao> = {}): UsuarioSessao {
  return {
    nome: 'Ana Souza',
    email: 'ana@clinica.com.br',
    papel: 'GERENTE',
    isSuperAdmin: false,
    empresaAtiva: { id: 'empresa-1', nome: 'Clínica São Lucas' },
    ...sobrescritas,
  };
}

/** Troca `window.location` por uma cópia com `reload` espiável — `vi.spyOn` não funciona (a propriedade não é redefinível no jsdom). */
function instalarLocationFalso() {
  const original = window.location;
  const reload = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
  return { reload, restaurar: () => Object.defineProperty(window, 'location', { configurable: true, value: original }) };
}

beforeEach(() => {
  pathnameAtual = '/pipeline';
  FakeEventSource.instancias = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  instalarFetchFalso({});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.fetch = fetchOriginal;
  pushMock.mockClear();
  refreshMock.mockClear();
});

describe('AC-348: o menu traz os grupos e itens do protótipo', () => {
  test('mostra os 4 grupos e os itens na ordem do protótipo, com ícone, rota e rodapé @spec:AC-348', () => {
    // "Dado um usuário MASTER logado" + "mostra ... Administração (..., Empresas)":
    // só o super admin vê Empresas (AC-349) — aqui o MASTER também é super
    // admin (mesmo padrão de test/api/auth-http.test.ts: `isSuperAdmin` é
    // independente do `papel`), o que deixa o catálogo completo visível.
    const { container } = render(<MenuLateral papel="MASTER" isSuperAdmin={true} />);

    const titulosGrupo = ['Operação', 'Comunicação', 'Análises', 'Administração'];
    for (const titulo of titulosGrupo) {
      expect(screen.getByText(titulo)).toBeTruthy();
    }

    const idsEsperados = [
      'funil-pipeline',
      'lista',
      'arquivados',
      'tarefas-do-turno',
      'tarefas-atrasadas',
      'agenda',
      'whatsapp-inbox',
      'whatsapp-conexao',
      'whatsapp-configuracao',
      'whatsapp-templates',
      'whatsapp-lote',
      'campanhas',
      'indicadores',
      'relatorios',
      'comercial',
      'equipe',
      'motivos-de-perda',
      'metas',
      'investimento-midia',
      'email-empresa',
      'google-meet',
      'empresas',
    ];
    const idsRenderizados = Array.from(container.querySelectorAll('a[data-path]')).map((a) =>
      a.getAttribute('data-path')
    );
    expect(idsRenderizados).toEqual(idsEsperados);

    const linkPipeline = container.querySelector('a[data-path="funil-pipeline"]')!;
    expect(linkPipeline.getAttribute('href')).toBe('/pipeline');
    expect(linkPipeline.textContent).toContain('view_kanban');
    expect(linkPipeline.textContent).toContain('Funil Pipeline');

    const linkEmpresas = container.querySelector('a[data-path="empresas"]')!;
    expect(linkEmpresas.getAttribute('href')).toBe('/admin/empresas');

    expect(screen.getByText('Ajuda & Suporte')).toBeTruthy();
    expect(screen.getByText(`v${packageJson.version}`)).toBeTruthy();
  });
});

describe('AC-349: o menu esconde o que o papel não pode ver', () => {
  test('ATENDENTE vê só Operação e Comunicação @spec:AC-349', () => {
    const { container } = render(<MenuLateral papel="ATENDENTE" isSuperAdmin={false} />);

    expect(screen.getByText('Operação')).toBeTruthy();
    expect(screen.getByText('Comunicação')).toBeTruthy();
    expect(screen.queryByText('Análises')).toBeNull();
    expect(screen.queryByText('Administração')).toBeNull();
    expect(container.querySelectorAll('a[data-path]')).toHaveLength(11);
  });

  test('GERENTE vê também Análises e, em Administração, só Equipe e Motivos de Perda @spec:AC-349', () => {
    const { container } = render(<MenuLateral papel="GERENTE" isSuperAdmin={false} />);

    expect(screen.getByText('Análises')).toBeTruthy();
    expect(screen.getByText('Administração')).toBeTruthy();
    expect(container.querySelector('a[data-path="equipe"]')).toBeTruthy();
    expect(container.querySelector('a[data-path="motivos-de-perda"]')).toBeTruthy();
    expect(container.querySelector('a[data-path="empresas"]')).toBeNull();
  });

  test('MASTER vê tudo menos Empresas @spec:AC-349', () => {
    const { container } = render(<MenuLateral papel="MASTER" isSuperAdmin={false} />);

    expect(screen.getByText('Análises')).toBeTruthy();
    expect(container.querySelector('a[data-path="equipe"]')).toBeTruthy();
    expect(container.querySelector('a[data-path="indicadores"]')).toBeTruthy();
    expect(container.querySelector('a[data-path="empresas"]')).toBeNull();
  });

  test('o super admin vê tudo, inclusive Empresas, mesmo com papel baixo @spec:AC-349', () => {
    const { container } = render(<MenuLateral papel="ATENDENTE" isSuperAdmin={true} />);

    expect(screen.getByText('Análises')).toBeTruthy();
    expect(screen.getByText('Administração')).toBeTruthy();
    expect(container.querySelector('a[data-path="empresas"]')).toBeTruthy();
  });
});

describe('AC-350: o item da tela atual aparece destacado', () => {
  function classesAtivo(elemento: Element): boolean {
    return (
      elemento.className.includes('bg-sidebar-surface-active') &&
      elemento.className.includes('font-semibold') &&
      elemento.className.includes('text-surface-container-lowest')
    );
  }

  test('em /tarefas/atrasadas, só "Tarefas Atrasadas" tem o estilo ativo @spec:AC-350', () => {
    pathnameAtual = '/tarefas/atrasadas';
    const { container } = render(<MenuLateral papel="MASTER" isSuperAdmin={true} />);

    const ativo = container.querySelector('a[data-path="tarefas-atrasadas"]')!;
    expect(classesAtivo(ativo)).toBe(true);

    const outros = Array.from(container.querySelectorAll('a[data-path]')).filter(
      (a) => a.getAttribute('data-path') !== 'tarefas-atrasadas'
    );
    for (const outro of outros) {
      expect(classesAtivo(outro)).toBe(false);
    }
  });

  test('em /pipeline/<id>/cadencia, "Funil Pipeline" fica ativo e "Lista"/"Arquivados" não @spec:AC-350', () => {
    pathnameAtual = '/pipeline/abc123/cadencia';
    const { container } = render(<MenuLateral papel="MASTER" isSuperAdmin={true} />);

    expect(classesAtivo(container.querySelector('a[data-path="funil-pipeline"]')!)).toBe(true);
    expect(classesAtivo(container.querySelector('a[data-path="lista"]')!)).toBe(false);
    expect(classesAtivo(container.querySelector('a[data-path="arquivados"]')!)).toBe(false);
  });
});

describe('AC-351: os contadores do menu mostram números reais', () => {
  function itensFila(vigentes: number, atrasados: number) {
    return [
      ...Array.from({ length: vigentes }, () => ({ atrasado: false })),
      ...Array.from({ length: atrasados }, () => ({ atrasado: true })),
    ];
  }

  test('mostra 12 no turno, 4 (vermelho) nos atrasados e 5 (verde) no WhatsApp @spec:AC-351', async () => {
    instalarFetchFalso({
      '/api/atividades': { corpo: { itens: itensFila(12, 4) } },
      '/api/whatsapp/unread': { corpo: { conversas: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}` })) } },
    });
    const { container } = render(<MenuLateral papel="MASTER" isSuperAdmin={true} />);

    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());
    const badgeTurno = screen.getByText('12');
    expect(badgeTurno.className).toContain('bg-primary-container');

    const badgeAtrasadas = screen.getByText('4');
    expect(badgeAtrasadas.className).toContain('bg-danger-surface');
    expect(badgeAtrasadas.className).toContain('text-danger-text');

    const badgeWhatsapp = screen.getByText('5');
    expect(badgeWhatsapp.className).toContain('bg-success-surface');
    expect(badgeWhatsapp.className).toContain('text-success-text');

    // Confere que cada selo está dentro do item certo (não trocados entre si).
    expect(container.querySelector('a[data-path="tarefas-do-turno"]')!.textContent).toContain('12');
    expect(container.querySelector('a[data-path="tarefas-atrasadas"]')!.textContent).toContain('4');
    expect(container.querySelector('a[data-path="whatsapp-inbox"]')!.textContent).toContain('5');
  });

  test('contagem zero ou consulta falhando esconde o contador, nunca mostra 0 inventado @spec:AC-351', async () => {
    instalarFetchFalso({
      '/api/atividades': { corpo: { itens: itensFila(0, 0) } },
      '/api/whatsapp/unread': { status: 500, corpo: {} },
    });
    const { container } = render(<MenuLateral papel="MASTER" isSuperAdmin={true} />);

    await waitFor(() => {
      expect(container.querySelector('a[data-path="tarefas-do-turno"]')!.querySelector('span.rounded-full')).toBeNull();
    });
    expect(screen.queryByText('0')).toBeNull();
    expect(container.querySelector('a[data-path="tarefas-atrasadas"]')!.querySelector('span.rounded-full')).toBeNull();
    expect(container.querySelector('a[data-path="whatsapp-inbox"]')!.querySelector('span.rounded-full')).toBeNull();
  });
});

describe('AC-761: os números de tarefas do menu acompanham a fila sem recarregar a página', () => {
  const itens = (vigentes: number, atrasados: number) => [
    ...Array.from({ length: vigentes }, () => ({ atrasado: false })),
    ...Array.from({ length: atrasados }, () => ({ atrasado: true })),
  ];
  const noMenu = (container: HTMLElement, id: string) => container.querySelector(`a[data-path="${id}"]`)!.querySelector('span.rounded-full')?.textContent ?? null;

  test('quando a fila muda (cadencia.fila_alterada), o menu relê e atualiza, e o selo some quando zera @spec:AC-761', async () => {
    instalarFetchFalso({ '/api/atividades': { corpo: { itens: itens(6, 2) } }, '/api/whatsapp/unread': { corpo: { conversas: [] } } });
    const { container } = render(<MenuLateral papel="MASTER" isSuperAdmin={true} />);
    await waitFor(() => expect(noMenu(container, 'tarefas-do-turno')).toBe('6'));
    expect(noMenu(container, 'tarefas-atrasadas')).toBe('2');

    const fila = FakeEventSource.instancias.find((i) => i.url === '/api/stream')!;
    expect(fila).toBeTruthy();

    instalarFetchFalso({ '/api/atividades': { corpo: { itens: itens(3, 2) } }, '/api/whatsapp/unread': { corpo: { conversas: [] } } });
    await act(async () => fila.disparar('cadencia.fila_alterada', { data: '{}' }));
    await waitFor(() => expect(noMenu(container, 'tarefas-do-turno')).toBe('3'));
    expect(noMenu(container, 'tarefas-atrasadas')).toBe('2');

    instalarFetchFalso({ '/api/atividades': { corpo: { itens: itens(0, 0) } }, '/api/whatsapp/unread': { corpo: { conversas: [] } } });
    await act(async () => fila.disparar('cadencia.fila_alterada', { data: '{}' }));
    await waitFor(() => expect(noMenu(container, 'tarefas-do-turno')).toBeNull());
    expect(noMenu(container, 'tarefas-atrasadas')).toBeNull();
  });

  test('ao reconectar o canal o menu também relê, e uma falha na leitura mantém o número que já estava @spec:AC-761', async () => {
    instalarFetchFalso({ '/api/atividades': { corpo: { itens: itens(4, 0) } }, '/api/whatsapp/unread': { corpo: { conversas: [] } } });
    const { container } = render(<MenuLateral papel="MASTER" isSuperAdmin={true} />);
    await waitFor(() => expect(noMenu(container, 'tarefas-do-turno')).toBe('4'));
    const fila = FakeEventSource.instancias.find((i) => i.url === '/api/stream')!;

    instalarFetchFalso({ '/api/atividades': { corpo: { itens: itens(1, 0) } } });
    await act(async () => fila.disparar('stream.reconectado'));
    await waitFor(() => expect(noMenu(container, 'tarefas-do-turno')).toBe('1'));

    instalarFetchFalso({ '/api/atividades': { status: 500, corpo: {} } });
    await act(async () => fila.disparar('cadencia.fila_alterada', { data: '{}' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(noMenu(container, 'tarefas-do-turno')).toBe('1');
  });
});

describe('AC-352: o topo mostra quem está logado', () => {
  test('mostra nome, papel, e-mail e empresa ativa da sessão @spec:AC-352', () => {
    const usuario = usuarioBase({
      nome: 'Ana Souza',
      papel: 'GERENTE',
      email: 'ana@clinica.com.br',
      empresaAtiva: { id: 'e1', nome: 'Clínica São Lucas' },
    });
    render(<Topo usuario={usuario} />);

    expect(screen.getByText('Ana Souza')).toBeTruthy();
    expect(screen.getByText('GERENTE')).toBeTruthy();
    expect(screen.getByText('ana@clinica.com.br')).toBeTruthy();
    expect(screen.getByText('Clínica São Lucas')).toBeTruthy();
  });
});

describe('AC-353: só o super admin vê e usa o seletor de empresa', () => {
  test('super admin troca a empresa ativa e a tela recarrega @spec:AC-353', async () => {
    const fetchFalso = instalarFetchFalso({ '/api/empresa-ativa': { corpo: { ok: true } } });
    const { reload, restaurar } = instalarLocationFalso();
    const usuario = usuarioBase({
      isSuperAdmin: true,
      empresaAtiva: { id: 'e1', nome: 'Clínica São Lucas' },
      empresas: [
        { id: 'e1', nome: 'Clínica São Lucas' },
        { id: 'e2', nome: 'Clínica Bem Cuidar' },
      ],
    });
    render(<Topo usuario={usuario} />);

    const seletor = screen.getByLabelText('Empresa ativa') as HTMLSelectElement;
    expect(seletor.value).toBe('e1');

    await userEvent.selectOptions(seletor, 'e2');

    await waitFor(() => expect(reload).toHaveBeenCalled());
    const chamada = fetchFalso.mock.calls.find(([url]) => String(url).startsWith('/api/empresa-ativa'));
    expect(chamada).toBeTruthy();
    const [, init] = chamada!;
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ empresaId: 'e2' });

    restaurar();
  });

  test('o MASTER (sem ser super admin) não vê o seletor de empresa @spec:AC-353', () => {
    const usuario = usuarioBase({ papel: 'MASTER', isSuperAdmin: false });
    render(<Topo usuario={usuario} />);

    expect(screen.queryByLabelText('Empresa ativa')).toBeNull();
  });
});

describe('AC-354: o indicador de tempo real diz a verdade', () => {
  test('mostra conectado enquanto aberto, reconectando quando cai, e volta ao verde sem recarregar @spec:AC-354', () => {
    render(<Topo usuario={usuarioBase()} />);
    const origem = FakeEventSource.instancias[0];
    expect(origem).toBeDefined();

    // Antes de confirmar a conexão, o indicador não promete o que não sabe.
    expect(screen.getByText('Reconectando…')).toBeTruthy();

    act(() => {
      origem.disparar('open');
    });
    expect(screen.getByText('Tempo real conectado')).toBeTruthy();
    expect(screen.queryByText('Reconectando…')).toBeNull();

    act(() => {
      origem.disparar('error');
    });
    expect(screen.getByText('Reconectando…')).toBeTruthy();
    expect(screen.queryByText('Tempo real conectado')).toBeNull();

    act(() => {
      origem.disparar('open');
    });
    expect(screen.getByText('Tempo real conectado')).toBeTruthy();
  });
});

describe('AC-355: o que não tem backend aparece como "em breve"', () => {
  test('busca global, sino de notificações e Ajuda & Suporte continuam visíveis, marcados "em breve", sem ação ao clicar @spec:AC-355', async () => {
    render(<Topo usuario={usuarioBase()} />);
    render(<MenuLateral papel="MASTER" isSuperAdmin={false} />);

    const busca = screen.getByPlaceholderText(/Buscar lead/i) as HTMLInputElement;
    expect(busca.readOnly).toBe(true);
    await userEvent.type(busca, 'abc');
    expect(busca.value).toBe('');

    const sino = screen.getByRole('button', { name: /Notificações/i });
    await userEvent.click(sino);
    expect(pushMock).not.toHaveBeenCalled();

    const ajuda = screen.getByText('Ajuda & Suporte');
    expect(screen.queryByRole('link', { name: /Ajuda & Suporte/i })).toBeNull();
    await userEvent.click(ajuda);
    expect(pushMock).not.toHaveBeenCalled();

    const selosEmBreve = screen.getAllByText(/em breve/i);
    expect(selosEmBreve.length).toBeGreaterThanOrEqual(3);
  });
});

describe('AC-356: no celular o menu vira gaveta', () => {
  test('o botão do topo abre a gaveta sobre um fundo escurecido, e ela fecha ao tocar no fundo ou escolher um item @spec:AC-356', async () => {
    instalarFetchFalso({
      '/api/me': { corpo: usuarioBase() },
      '/api/atividades': { corpo: { itens: [] } },
      '/api/whatsapp/unread': { corpo: { conversas: [] } },
    });

    render(<AppLayout>
      <div>Conteúdo da página</div>
    </AppLayout>);

    const botaoAbrir = await screen.findByRole('button', { name: 'Abrir menu' });
    const aside = screen.getByRole('complementary');

    expect(aside.className).toContain('-translate-x-full');
    expect(screen.queryByTestId('gaveta-backdrop')).toBeNull();

    await userEvent.click(botaoAbrir);
    expect(aside.className).not.toContain('-translate-x-full');
    expect(screen.getByTestId('gaveta-backdrop')).toBeTruthy();

    await userEvent.click(screen.getByTestId('gaveta-backdrop'));
    expect(aside.className).toContain('-translate-x-full');
    expect(screen.queryByTestId('gaveta-backdrop')).toBeNull();

    await userEvent.click(botaoAbrir);
    expect(screen.getByTestId('gaveta-backdrop')).toBeTruthy();
    const primeiroItem = aside.querySelector('a[data-path]')!;
    await userEvent.click(primeiroItem);
    expect(screen.queryByTestId('gaveta-backdrop')).toBeNull();
    expect(aside.className).toContain('-translate-x-full');
  });
});

describe('AC-357: sair encerra a sessão', () => {
  test('"Sair" chama o sign-out do Better Auth e leva ao login @spec:AC-357', async () => {
    const fetchFalso = instalarFetchFalso({ '/api/auth/sign-out': { corpo: {} } });
    render(<Topo usuario={usuarioBase()} />);

    await userEvent.click(screen.getByText('Ana Souza'));
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
    expect(refreshMock).toHaveBeenCalled();
    const chamada = fetchFalso.mock.calls.find(([url]) => String(url).startsWith('/api/auth/sign-out'));
    expect(chamada).toBeTruthy();
    expect(chamada![1]?.method).toBe('POST');
    // O Better Auth responde 415 (e não encerra a sessão) sem o Content-Type JSON.
    expect(chamada![1]?.headers).toEqual({ 'content-type': 'application/json' });
    expect(chamada![1]?.body).toBe('{}');
  });

  test('se o sign-out for recusado, não vai ao login e avisa que não saiu @spec:AC-357', async () => {
    pushMock.mockClear();
    refreshMock.mockClear();
    instalarFetchFalso({ '/api/auth/sign-out': { status: 415, corpo: { code: 'UNSUPPORTED_MEDIA_TYPE' } } });
    render(<Topo usuario={usuarioBase()} />);

    await userEvent.click(screen.getByText('Ana Souza'));
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível sair. Tente de novo.');
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  test('sem rede, também não vai ao login e avisa @spec:AC-357', async () => {
    pushMock.mockClear();
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('sem rede'))) as unknown as typeof fetch;
    render(<Topo usuario={usuarioBase()} />);

    await userEvent.click(screen.getByText('Ana Souza'));
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível sair. Tente de novo.');
    expect(pushMock).not.toHaveBeenCalled();
  });
});
