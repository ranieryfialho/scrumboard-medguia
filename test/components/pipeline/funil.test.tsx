// @vitest-environment jsdom
//
// Testes de T-160 (fase4-pipeline-telas, US-106): a tela do funil
// (`src/app/(app)/pipeline/page.tsx`, com `BoardKanban` e as peças novas —
// `FiltrosFunil`, `IndicadoresFunil`, `ModalNovoLead`). `EventSource`
// mockado (mesmo `FakeEventSource` de test/sse/board-evento.test.tsx —
// jsdom não implementa `EventSource`) porque `useStreamOportunidades` abre
// uma conexão ao montar. O filtro (AC-390) reaproveita as rotas já
// filtradas no servidor de `/api/oportunidades/lista` (etapas 1-13, com
// origem) e `/api/oportunidades/arquivados` (etapas 14/15, sem origem no
// servidor — por isso o mock replica exatamente essa assimetria real de
// `pipeline-lista.ts`, T-154).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PipelinePage from '../../../src/app/(app)/pipeline/page';

type Ouvinte = (evento: unknown) => void;

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
}

interface LeadTeste {
  nome: string;
  email: string | null;
  telefoneE164: string | null;
  origem: string | null;
}

interface ItemCatalogoTeste {
  id: string;
  lead: LeadTeste;
  responsavel: { id: string; nome: string } | null;
}

const OP_A = 'op-a';
const OP_B = 'op-b';
const OP_C = 'op-c';

const RESP_JULIANA = { id: 'resp-1', nome: 'Dra. Juliana' };
const RESP_CARLOS = { id: 'resp-2', nome: 'Carlos M.' };

let listaDataset: ItemCatalogoTeste[];
let arquivadosDataset: ItemCatalogoTeste[];
let boardItens: { id: string; etapaId: number; leadId: string; leadNome: string; responsavelId: string | null; responsavelNome: string | null; valor: string | null; version: number }[];
let atrasadosItens: { oportunidade: { id: string; proximaAcaoEm?: string | null }; atrasado: boolean }[];

function montarCatalogoPadrao() {
  listaDataset = [
    {
      id: OP_A,
      lead: { nome: 'Clínica Vitae', email: null, telefoneE164: '+5511988887777', origem: 'Google Ads' },
      responsavel: RESP_JULIANA,
    },
    {
      id: OP_B,
      lead: { nome: 'Instituto Gastro', email: null, telefoneE164: '+5519991201198', origem: 'Indicação' },
      responsavel: RESP_CARLOS,
    },
  ];
  arquivadosDataset = [
    {
      id: OP_C,
      lead: { nome: 'Hospital São Lucas', email: null, telefoneE164: null, origem: 'Google Ads' },
      responsavel: null,
    },
  ];
  boardItens = [
    { id: OP_A, etapaId: 1, leadId: 'lead-a', leadNome: 'Clínica Vitae', responsavelId: RESP_JULIANA.id, responsavelNome: RESP_JULIANA.nome, valor: '6800', version: 1 },
    { id: OP_B, etapaId: 1, leadId: 'lead-b', leadNome: 'Instituto Gastro', responsavelId: RESP_CARLOS.id, responsavelNome: RESP_CARLOS.nome, valor: '4200', version: 1 },
    { id: OP_C, etapaId: 15, leadId: 'lead-c', leadNome: 'Hospital São Lucas', responsavelId: null, responsavelNome: null, valor: '22000', version: 1 },
  ];
  atrasadosItens = [{ oportunidade: { id: OP_A, proximaAcaoEm: '2020-01-01T10:00:00.000Z' }, atrasado: true }];
}

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response);
}

function combina(item: ItemCatalogoTeste, busca: string | null, origem: string | null, responsavelId: string | null): boolean {
  if (busca) {
    const alvo = busca.toLowerCase();
    const acha =
      item.lead.nome.toLowerCase().includes(alvo) ||
      (item.lead.email ?? '').toLowerCase().includes(alvo) ||
      (item.lead.telefoneE164 ?? '').toLowerCase().includes(alvo);
    if (!acha) return false;
  }
  if (origem && item.lead.origem !== origem) return false;
  if (responsavelId && item.responsavel?.id !== responsavelId) return false;
  return true;
}

/** `/api/oportunidades/lista`: suporta origem no servidor (T-154). */
function paginaLista(searchParams: URLSearchParams) {
  const busca = searchParams.get('busca');
  const origem = searchParams.get('origem');
  const responsavelId = searchParams.get('responsavelId');
  const porPagina = Number(searchParams.get('porPagina')) || 10;
  const pagina = Number(searchParams.get('pagina')) || 1;
  const filtrados = listaDataset.filter((item) => combina(item, busca, origem, responsavelId));
  const inicio = (pagina - 1) * porPagina;
  return {
    itens: filtrados.slice(inicio, inicio + porPagina).map((item) => ({ id: item.id, lead: item.lead, responsavel: item.responsavel })),
    total: filtrados.length,
    pagina,
    porPagina,
  };
}

/** `/api/oportunidades/arquivados`: não filtra por origem no servidor (mesma assimetria real de `pipeline-lista.ts`). */
function paginaArquivados(searchParams: URLSearchParams) {
  const busca = searchParams.get('busca');
  const responsavelId = searchParams.get('responsavelId');
  const porPagina = Number(searchParams.get('porPagina')) || 10;
  const pagina = Number(searchParams.get('pagina')) || 1;
  const filtrados = arquivadosDataset.filter((item) => combina(item, busca, null, responsavelId));
  const inicio = (pagina - 1) * porPagina;
  return {
    itens: filtrados.slice(inicio, inicio + porPagina).map((item) => ({ id: item.id, lead: item.lead, responsavel: item.responsavel })),
    total: filtrados.length,
    pagina,
    porPagina,
  };
}

const fetchOriginal = globalThis.fetch;
let fetchFalso: ReturnType<typeof vi.fn>;

function coluna(nome: string): HTMLElement {
  return screen.getByText(nome).closest('div')!.parentElement!;
}

beforeEach(() => {
  FakeEventSource.instancias = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  montarCatalogoPadrao();

  fetchFalso = vi.fn((url: string, init?: RequestInit) => {
    const analisada = new URL(url, 'http://localhost');
    const partes = analisada.pathname.split('/').filter(Boolean);
    const metodo = init?.method ?? 'GET';

    if (analisada.pathname === '/api/oportunidades' && metodo === 'GET') {
      return resposta(200, { itens: boardItens, grafo: {} });
    }
    if (analisada.pathname === '/api/oportunidades' && metodo === 'POST') {
      return resposta(201, { id: 'op-novo', version: 1 });
    }
    if (analisada.pathname === '/api/atividades') {
      return resposta(200, { itens: atrasadosItens });
    }
    if (analisada.pathname === '/api/pipeline/indicadores') {
      return resposta(200, {
        cardsAtivos: { quantidade: 2, valorTotal: '11000' },
        toquesEmAtraso: 1,
        propostasAtivas: 0,
        conversao30Dias: { valor: null },
      });
    }
    if (analisada.pathname === '/api/oportunidades/lista') {
      return resposta(200, paginaLista(analisada.searchParams));
    }
    if (analisada.pathname === '/api/oportunidades/arquivados') {
      return resposta(200, paginaArquivados(analisada.searchParams));
    }
    if (partes.length === 5 && partes[0] === 'api' && partes[1] === 'oportunidades' && partes[3] === 'cadencia' && partes[4] === 'iniciar') {
      return resposta(200, { oportunidade: { etapaId: 2, version: 2 }, toques: [1, 2, 3] });
    }
    return resposta(404, { codigo: 'NAO_ENCONTRADO' });
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.fetch = fetchOriginal;
});

describe('T-160: tela do funil', () => {
  describe('AC-387: o funil aparece dentro da casca, com as 15 colunas', () => {
    test('a página nova mostra o quadro com as 15 etapas @spec:AC-387', async () => {
      render(<PipelinePage />);

      await screen.findByText('Clínica Vitae');

      const nomes = [
        'Entrada de leads',
        '1º dia de contato',
        '2º dia de contato',
        '3º dia de contato',
        'Qualificando',
        'Qualificado p/ reunião',
        'Follow de longo prazo',
        'Reunião agendada',
        'No-show',
        'Reunião realizada',
        'Proposta',
        'Teste (Trial)',
        'Negociação',
        'Perdido',
        'Contrato (Ganho)',
      ];
      for (const nome of nomes) {
        expect(screen.getByText(nome)).toBeTruthy();
      }
    });
  });

  describe('AC-388: coluna e card mostram etapa, contagem, soma, responsável, valor, próxima ação e atraso', () => {
    test('a coluna "Entrada de leads" mostra 2 cards e a soma dos valores @spec:AC-388', async () => {
      render(<PipelinePage />);
      await screen.findByText('Clínica Vitae');

      const entrada = coluna('Entrada de leads');
      expect(within(entrada).getByText('2 cards • R$ 11.000,00')).toBeTruthy();
    });

    test('o card atrasado mostra o selo "Atrasado" e a próxima ação; o outro mostra "Sem próxima ação" @spec:AC-388', async () => {
      render(<PipelinePage />);
      await screen.findByText('Clínica Vitae');

      const cardAtrasado = screen.getByText('Clínica Vitae').closest('.relative') as HTMLElement;
      const cardEmDia = screen.getByText('Instituto Gastro').closest('.relative') as HTMLElement;

      expect(within(cardAtrasado).getByText('Atrasado')).toBeTruthy();
      expect(within(cardAtrasado).getByText('Dra. Juliana')).toBeTruthy();
      expect(within(cardAtrasado).getByText(/R\$\s*6\.800,00/)).toBeTruthy();
      const esperado = new Date('2020-01-01T10:00:00.000Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      expect(within(cardAtrasado).getByText(esperado)).toBeTruthy();

      expect(within(cardEmDia).queryByText('Atrasado')).toBeNull();
      expect(within(cardEmDia).getByText('Sem próxima ação')).toBeTruthy();
    });
  });

  describe('AC-390: os filtros do funil restringem o quadro', () => {
    test('escolher a origem "Google Ads" mostra só os cards dessa origem, mesmo um deles arquivado @spec:AC-390', async () => {
      render(<PipelinePage />);
      await screen.findByText('Clínica Vitae');
      await screen.findByText('Hospital São Lucas');

      const usuario = userEvent.setup();
      await usuario.selectOptions(screen.getByLabelText('Origem'), 'Google Ads');

      await waitFor(() => {
        expect(screen.queryByText('Instituto Gastro')).toBeNull();
      });
      expect(screen.getByText('Clínica Vitae')).toBeTruthy();
      expect(screen.getByText('Hospital São Lucas')).toBeTruthy();
    });

    test('digitar na busca restringe por nome do lead @spec:AC-390', async () => {
      render(<PipelinePage />);
      await screen.findByText('Clínica Vitae');

      fireEvent.change(screen.getByLabelText('Buscar no funil'), { target: { value: 'Gastro' } });

      await waitFor(() => {
        expect(screen.queryByText('Clínica Vitae')).toBeNull();
      });
      expect(screen.getByText('Instituto Gastro')).toBeTruthy();
    });

    test('escolher o responsável restringe o quadro e as contagens das colunas refletem o filtro @spec:AC-390', async () => {
      render(<PipelinePage />);
      await screen.findByText('Clínica Vitae');

      const usuario = userEvent.setup();
      await usuario.selectOptions(screen.getByLabelText('Responsável'), RESP_JULIANA.id);

      await waitFor(() => expect(screen.queryByText('Instituto Gastro')).toBeNull());
      const entrada = coluna('Entrada de leads');
      expect(within(entrada).getByText('1 card • R$ 6.800,00')).toBeTruthy();
    });

    test('"Limpar" volta ao quadro completo @spec:AC-390', async () => {
      render(<PipelinePage />);
      await screen.findByText('Clínica Vitae');

      fireEvent.change(screen.getByLabelText('Buscar no funil'), { target: { value: 'Gastro' } });
      await waitFor(() => expect(screen.queryByText('Clínica Vitae')).toBeNull());

      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole('button', { name: 'Limpar' }));

      await waitFor(() => expect(screen.getByText('Clínica Vitae')).toBeTruthy());
      expect(screen.getByText('Instituto Gastro')).toBeTruthy();
      expect(screen.getByText('Hospital São Lucas')).toBeTruthy();
    });
  });

  describe('AC-391/AC-392: "Novo Lead" cria o card e, quando pedido, já inicia a cadência', () => {
    test('"Criar Card na Entrada" chama só a criação do card @spec:AC-391', async () => {
      render(<PipelinePage />);
      await screen.findByText('Clínica Vitae');

      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole('button', { name: 'Novo Lead' }));

      await usuario.type(screen.getByLabelText('Nome da Clínica / Médico *'), 'Clínica Oftalmo Alphaville');
      await usuario.type(screen.getByLabelText('WhatsApp / Telefone *'), '11988880000');
      await usuario.selectOptions(screen.getByLabelText('Origem do Lead *'), 'Google Ads');

      await usuario.click(screen.getByRole('button', { name: 'Criar Card na Entrada' }));

      await waitFor(() => {
        const chamadaCriacao = fetchFalso.mock.calls.find(
          (chamada: unknown[]) => chamada[0] === '/api/oportunidades' && (chamada[1] as RequestInit | undefined)?.method === 'POST'
        );
        expect(chamadaCriacao).toBeTruthy();
        const corpo = JSON.parse((chamadaCriacao![1] as RequestInit).body as string);
        expect(corpo).toEqual({
          novoLead: { nome: 'Clínica Oftalmo Alphaville', telefone: '11988880000', email: undefined, origem: 'Google Ads' },
          valor: undefined,
          responsavelId: undefined,
        });
      });

      const chamouCadencia = fetchFalso.mock.calls.some((chamada: unknown[]) => String(chamada[0]).includes('/cadencia/iniciar'));
      expect(chamouCadencia).toBe(false);
    });

    test('"Salvar e Iniciar Cadência" cria o card e inicia a cadência na sequência @spec:AC-392', async () => {
      render(<PipelinePage />);
      await screen.findByText('Clínica Vitae');

      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole('button', { name: 'Novo Lead' }));

      await usuario.type(screen.getByLabelText('Nome da Clínica / Médico *'), 'Centro Médico Alvorada');
      await usuario.type(screen.getByLabelText('WhatsApp / Telefone *'), '41992017722');
      await usuario.selectOptions(screen.getByLabelText('Origem do Lead *'), 'Indicação');

      await usuario.click(screen.getByRole('button', { name: 'Salvar e Iniciar Cadência' }));

      await waitFor(() => {
        const chamadaCadencia = fetchFalso.mock.calls.find(
          (chamada: unknown[]) => chamada[0] === '/api/oportunidades/op-novo/cadencia/iniciar'
        );
        expect(chamadaCadencia).toBeTruthy();
        const corpo = JSON.parse((chamadaCadencia![1] as RequestInit).body as string);
        expect(corpo).toEqual({ version: 1 });
      });
    });
  });

  describe('AC-393 / AC-820: o "Período" do funil deixou de ser "em breve" e filtra de verdade', () => {
    test('não aparece mais marcado "em breve" e abre os períodos prontos, o Personalizado e a escolha da data @spec:AC-393 @spec:AC-820', async () => {
      render(<PipelinePage />);
      await screen.findByText('Clínica Vitae');

      expect(screen.queryByRole('button', { name: 'Período (em breve)' })).toBeNull();
      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole('button', { name: 'Período' }));

      for (const rotulo of ['Hoje', 'Últimos 7 dias', 'Últimos 30 dias', 'Este mês', 'Trimestre atual', 'Personalizado']) {
        expect(screen.getByRole('button', { name: rotulo })).toBeTruthy();
      }
      const data = screen.getByLabelText('Data do período') as HTMLSelectElement;
      expect(data.value).toBe('entrada');
      expect(within(data).getByRole('option', { name: 'Última movimentação' })).toBeTruthy();
    });

    test('escolher o período manda de/ate/data às duas buscas do quadro e "Limpar" tira o período @spec:AC-820 @spec:AC-821', async () => {
      render(<PipelinePage />);
      await screen.findByText('Clínica Vitae');

      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole('button', { name: 'Período' }));
      await usuario.selectOptions(screen.getByLabelText('Data do período'), 'movimentacao'); // o painel fecha ao aplicar: a data se escolhe antes
      await usuario.click(screen.getByRole('button', { name: 'Personalizado' }));
      fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-02-01' } });
      fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-02-28' } });
      await usuario.click(screen.getByRole('button', { name: 'Aplicar' }));

      const chamadas = (caminho: string) =>
        fetchFalso.mock.calls.map((c) => new URL(String(c[0]), 'http://localhost')).filter((u) => u.pathname === caminho);
      await waitFor(() => {
        for (const caminho of ['/api/oportunidades/lista', '/api/oportunidades/arquivados']) {
          const ultima = chamadas(caminho).filter((u) => u.searchParams.get('data') === 'movimentacao').pop();
          expect(ultima?.searchParams.get('de')).toBe('2026-02-01');
          expect(ultima?.searchParams.get('ate')).toBe('2026-02-28');
        }
      });

      const antes = fetchFalso.mock.calls.length;
      await usuario.click(screen.getByRole('button', { name: 'Limpar' }));
      await waitFor(() => expect(fetchFalso.mock.calls.length).toBeGreaterThanOrEqual(antes));
      expect(screen.getByRole('button', { name: 'Período' })).toBeTruthy(); // o rótulo voltou ao padrão: sem período
    });
  });

  describe('AC-759: "Iniciar Cadência em Massa" inicia a cadência de toda a Entrada de leads à vista', () => {
    test('pede confirmação com a quantidade, manda só os ids da Entrada de leads e mostra o resultado @spec:AC-759', async () => {
      const usuario = userEvent.setup();
      const base = fetchFalso.getMockImplementation() as (u: string, i?: RequestInit) => Promise<Response>;
      fetchFalso.mockImplementation(((url: string, init?: RequestInit) => {
        if (url === '/api/oportunidades/lote/iniciar-cadencia' && init?.method === 'POST') {
          return resposta(200, {
            resultados: [
              { id: OP_A, ok: true },
              { id: OP_B, ok: false, codigo: 'CADENCIA_JA_INICIADA' },
            ],
            aplicados: 1,
            falhas: 1,
          });
        }
        return base(url, init);
      }) as typeof fetch);
      render(<PipelinePage />);
      await screen.findByText('Clínica Vitae');

      await usuario.click(screen.getByRole('button', { name: 'Iniciar Cadência em Massa' }));
      const dialogo = screen.getByRole('alertdialog');
      expect(within(dialogo).getByText('Iniciar a cadência de 2 cards?')).toBeTruthy();
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      expect(fetchFalso.mock.calls.some(([u]) => u === '/api/oportunidades/lote/iniciar-cadencia')).toBe(false);

      await usuario.click(screen.getByRole('button', { name: 'Iniciar Cadência em Massa' }));
      await usuario.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Iniciar 2 cards' }));

      const chamada = await waitFor(() => {
        const c = fetchFalso.mock.calls.find(([u]) => u === '/api/oportunidades/lote/iniciar-cadencia');
        expect(c).toBeTruthy();
        return c!;
      });
      expect(JSON.parse((chamada[1] as RequestInit).body as string)).toEqual({ ids: [OP_A, OP_B] });

      const resultado = await screen.findByRole('region', { name: 'Resultado da ação em lote' });
      expect(within(resultado).getByText(/1 com a cadência iniciada, 1 sem a cadência iniciada/)).toBeTruthy();
      expect(within(resultado).getByText(/Este card já tem toques de cadência/)).toBeTruthy();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    test('sem cards na Entrada de leads o botão fica desabilitado @spec:AC-759', async () => {
      boardItens = boardItens.filter((item) => item.etapaId !== 1);
      render(<PipelinePage />);
      await screen.findByText('Hospital São Lucas');

      expect((screen.getByRole('button', { name: 'Iniciar Cadência em Massa' }) as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
