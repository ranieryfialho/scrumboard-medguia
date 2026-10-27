// @vitest-environment jsdom
//
// Testes de T-162 (fase4-pipeline-telas, US-108): a tela dos arquivados
// (`src/app/(app)/pipeline/arquivados/page.tsx`), com `TabelaArquivados`,
// `DistribuicaoMotivos` e `BotaoReabrir`. `next/navigation` mockado (mesmo
// molde de test/components/pipeline/lista.test.tsx) e fetch falso para
// `GET /api/oportunidades/arquivados`, `GET /api/pipeline/indicadores`,
// `GET /api/me`, `GET /api/oportunidades/:id` e
// `POST /api/oportunidades/:id/reabrir`. A casca (menu com "Arquivados"
// marcado, topo) vem do layout do grupo `(app)` (T-146) e já está provada
// em test/components/shell/casca.test.tsx; aqui a prova é o que esta tela
// renderiza dentro dela.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let paramsIniciais = new URLSearchParams();
const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => paramsIniciais,
}));

import PipelineArquivadosPage from '../../../src/app/(app)/pipeline/arquivados/page';

interface ItemArquivadoTeste {
  id: string;
  status: 'ganho' | 'perdido';
  valor: string | null;
  dataFechamento: string;
  lead: { id: string; nome: string; email: string | null; telefoneE164: string | null };
  responsavel: { id: string; nome: string } | null;
  motivoPerda: { id: string; nome: string } | null;
}

let contador = 0;

function itemGanho(overrides: Partial<ItemArquivadoTeste> = {}): ItemArquivadoTeste {
  contador += 1;
  return {
    id: overrides.id ?? `op-ganho-${contador}`,
    status: 'ganho',
    valor: overrides.valor ?? '5800.00',
    dataFechamento: overrides.dataFechamento ?? '2026-05-18T15:42:00-03:00',
    lead: overrides.lead ?? { id: `lead-${contador}`, nome: `Clínica Ganha ${contador}`, email: null, telefoneE164: null },
    responsavel: overrides.responsavel === undefined ? { id: 'resp-1', nome: 'Camila Prado' } : overrides.responsavel,
    motivoPerda: null,
  };
}

function itemPerdido(overrides: Partial<ItemArquivadoTeste> = {}): ItemArquivadoTeste {
  contador += 1;
  return {
    id: overrides.id ?? `op-perdido-${contador}`,
    status: 'perdido',
    valor: null,
    dataFechamento: overrides.dataFechamento ?? '2026-05-17T11:15:00-03:00',
    lead: overrides.lead ?? { id: `lead-${contador}`, nome: `Clínica Perdida ${contador}`, email: null, telefoneE164: null },
    responsavel: overrides.responsavel === undefined ? { id: 'resp-2', nome: 'Dr. Roberto Mendes' } : overrides.responsavel,
    motivoPerda: overrides.motivoPerda === undefined ? { id: 'motivo-1', nome: 'Preço acima do orçamento' } : overrides.motivoPerda,
  };
}

interface GrupoArquivados {
  itens: ItemArquivadoTeste[];
  total: number;
}

let dadosPorTipo: { todos: GrupoArquivados; ganho: GrupoArquivados; perdido: GrupoArquivados };
let usuarioAtual: { papel: string; isSuperAdmin: boolean };
let indicadoresAtuais: unknown;
let versaoAtualDoCard: number;
let chamadasReabrir: { id: string; body: Record<string, unknown> }[];

function configurarArquivados(grupos: Partial<typeof dadosPorTipo>) {
  dadosPorTipo = {
    todos: grupos.todos ?? { itens: [], total: 0 },
    ganho: grupos.ganho ?? { itens: [], total: 0 },
    perdido: grupos.perdido ?? { itens: [], total: 0 },
  };
}

function indicadoresPadrao() {
  return {
    valorGanho: '84500.00',
    negociosFechados: 24,
    conversaoFinal: { valor: 0.228, numerador: 24, denominador: 105 },
    perdas: { quantidade: 38, taxaPerda: { valor: 0.612, numerador: 38, denominador: 62 } },
    distribuicaoMotivos: [
      { motivoId: 'motivo-1', motivo: 'Preço acima do orçamento', quantidade: 15, percentual: 0.395 },
    ],
  };
}

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response);
}

const fetchOriginal = globalThis.fetch;
let fetchFalso: ReturnType<typeof vi.fn>;

beforeEach(() => {
  contador = 0;
  paramsIniciais = new URLSearchParams();
  routerReplace.mockClear();
  configurarArquivados({});
  usuarioAtual = { papel: 'GERENTE', isSuperAdmin: false };
  indicadoresAtuais = indicadoresPadrao();
  versaoAtualDoCard = 7;
  chamadasReabrir = [];

  fetchFalso = vi.fn((url: string, init?: RequestInit) => {
    const analisada = new URL(url, 'http://localhost');
    const partes = analisada.pathname.split('/').filter(Boolean);

    if (analisada.pathname === '/api/me') {
      return resposta(200, usuarioAtual);
    }
    if (analisada.pathname === '/api/pipeline/indicadores') {
      return resposta(200, indicadoresAtuais);
    }
    if (analisada.pathname === '/api/oportunidades/arquivados') {
      const tipoParam = analisada.searchParams.get('tipo');
      const chave = tipoParam === 'ganho' ? 'ganho' : tipoParam === 'perdido' ? 'perdido' : 'todos';
      const grupo = dadosPorTipo[chave];
      return resposta(200, {
        itens: grupo.itens,
        total: grupo.total,
        pagina: Number(analisada.searchParams.get('pagina')) || 1,
        porPagina: Number(analisada.searchParams.get('porPagina')) || 10,
      });
    }
    if (partes.length === 4 && partes[0] === 'api' && partes[1] === 'oportunidades' && partes[3] === 'reabrir') {
      const corpo = init?.body ? JSON.parse(init.body as string) : {};
      chamadasReabrir.push({ id: partes[2], body: corpo });
      return resposta(200, { id: partes[2] });
    }
    if (partes.length === 3 && partes[0] === 'api' && partes[1] === 'oportunidades') {
      return resposta(200, { version: versaoAtualDoCard });
    }
    return resposta(404, { codigo: 'NAO_ENCONTRADO' });
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
});

describe('T-162: tela dos arquivados', () => {
  describe('AC-400: os arquivados aparecem em /pipeline/arquivados com as três abas', () => {
    test('mostra as abas Todos, Ganhos e Perdidos com a contagem de cada uma @spec:AC-400', async () => {
      const ganho = itemGanho();
      const perdido = itemPerdido();
      configurarArquivados({
        todos: { itens: [ganho, perdido], total: 2 },
        ganho: { itens: [ganho], total: 1 },
        perdido: { itens: [perdido], total: 1 },
      });

      render(<PipelineArquivadosPage />);

      expect(await screen.findByText('Cards Arquivados (Fechamentos)')).toBeTruthy();
      expect(await screen.findByRole('button', { name: 'Todos 2' })).toBeTruthy();
      expect(await screen.findByRole('button', { name: 'Ganhos 1' })).toBeTruthy();
      expect(await screen.findByRole('button', { name: 'Perdidos 1' })).toBeTruthy();
    });

    test('cada aba lista só os cards daquele tipo @spec:AC-400', async () => {
      const ganho = itemGanho({ lead: { id: 'l-ganho', nome: 'Clínica São Rafael', email: null, telefoneE164: null } });
      const perdido = itemPerdido({ lead: { id: 'l-perdido', nome: 'Centro Dermatológico Vitalle', email: null, telefoneE164: null } });
      configurarArquivados({
        todos: { itens: [ganho, perdido], total: 2 },
        ganho: { itens: [ganho], total: 1 },
        perdido: { itens: [perdido], total: 1 },
      });

      render(<PipelineArquivadosPage />);

      expect(await screen.findByText('Clínica São Rafael')).toBeTruthy();
      expect(screen.getByText('Centro Dermatológico Vitalle')).toBeTruthy();

      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Ganhos 1' }));

      await waitFor(() => {
        expect(screen.getByText('Clínica São Rafael')).toBeTruthy();
        expect(screen.queryByText('Centro Dermatológico Vitalle')).toBeNull();
      });
    });
  });

  describe('AC-401: cada linha traz status, responsável, motivo e data de fechamento', () => {
    test('o perdido mostra o selo "Perdido" e o motivo, com o consultor e a data de fechamento @spec:AC-401', async () => {
      const perdido = itemPerdido({
        lead: { id: 'l1', nome: 'Centro Dermatológico Vitalle', email: null, telefoneE164: null },
        responsavel: { id: 'r1', nome: 'Dr. Roberto Mendes' },
        motivoPerda: { id: 'm1', nome: 'Preço acima do orçamento' },
        dataFechamento: '2026-05-17T11:15:00-03:00',
      });
      configurarArquivados({ todos: { itens: [perdido], total: 1 } });

      render(<PipelineArquivadosPage />);

      const tabela = await screen.findByRole('table');
      const esperadoData = new Date('2026-05-17T11:15:00-03:00').toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      });

      expect(within(tabela).getByText('Perdido')).toBeTruthy();
      expect(within(tabela).getByText('Preço acima do orçamento')).toBeTruthy();
      expect(within(tabela).getByText('Dr. Roberto Mendes')).toBeTruthy();
      expect(within(tabela).getByText(esperadoData)).toBeTruthy();
    });

    test('o ganho mostra o selo "Ganho" e o valor, com o consultor e a data de fechamento @spec:AC-401', async () => {
      const ganho = itemGanho({
        lead: { id: 'l2', nome: 'Clínica São Rafael Ortopedia', email: null, telefoneE164: null },
        responsavel: { id: 'r2', nome: 'Camila Prado' },
        valor: '5800.00',
        dataFechamento: '2026-05-18T15:42:00-03:00',
      });
      configurarArquivados({ todos: { itens: [ganho], total: 1 } });

      render(<PipelineArquivadosPage />);

      const tabela = await screen.findByRole('table');
      const esperadoData = new Date('2026-05-18T15:42:00-03:00').toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      });

      expect(within(tabela).getByText('Ganho')).toBeTruthy();
      expect(within(tabela).getByText(/R\$\s*5\.800,00/)).toBeTruthy();
      expect(within(tabela).getByText('Camila Prado')).toBeTruthy();
      expect(within(tabela).getByText(esperadoData)).toBeTruthy();
    });
  });

  describe('AC-403: os indicadores dos arquivados vêm dos dados reais', () => {
    test('os quatro cartões e a distribuição de motivos mostram os dados da API @spec:AC-403', async () => {
      configurarArquivados({ todos: { itens: [itemGanho()], total: 1 } });

      render(<PipelineArquivadosPage />);

      expect(await screen.findByText('Total Ganho')).toBeTruthy();
      expect(screen.getByText(/R\$\s*84\.500,00/)).toBeTruthy();
      expect(screen.getByText('Negócios Fechados')).toBeTruthy();
      expect(screen.getByText('24')).toBeTruthy();
      expect(screen.getByText('Conversão Final')).toBeTruthy();
      expect(screen.getByText('22.8%')).toBeTruthy();
      expect(screen.getByText('Perdas no Mês')).toBeTruthy();
      expect(screen.getByText('38')).toBeTruthy();
      expect(screen.getByText('Taxa de perda: 61.2%')).toBeTruthy();

      expect(screen.getByText('Distribuição de Motivos de Perda')).toBeTruthy();
      expect(screen.getByText('Preço acima do orçamento')).toBeTruthy();
      expect(screen.getByText('15 (39.5%)')).toBeTruthy();
    });
  });

  describe('AC-404: "Reabrir" volta o card ao funil respeitando as regras', () => {
    test('MASTER/GERENTE informa a justificativa e "Reabrir" chama a API com a versão atual @spec:AC-404', async () => {
      usuarioAtual = { papel: 'GERENTE', isSuperAdmin: false };
      const perdido = itemPerdido({ id: 'op-reabrir-1', lead: { id: 'l1', nome: 'OftalmoGastro Prime', email: null, telefoneE164: null } });
      configurarArquivados({ todos: { itens: [perdido], total: 1 } });
      versaoAtualDoCard = 9;

      render(<PipelineArquivadosPage />);
      await screen.findByText('OftalmoGastro Prime');

      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole('button', { name: 'Reabrir' }));

      await usuario.type(screen.getByLabelText('Justificativa (obrigatória)'), 'Cliente pediu novo contato');
      await usuario.click(screen.getByRole('button', { name: 'Confirmar e Reabrir' }));

      await waitFor(() => {
        expect(chamadasReabrir).toHaveLength(1);
        expect(chamadasReabrir[0].id).toBe('op-reabrir-1');
        expect(chamadasReabrir[0].body).toEqual({ version: 9, justificativa: 'Cliente pediu novo contato' });
      });

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Confirmar e Reabrir' })).toBeNull();
      });
    });

    test('ATENDENTE vê "Reabrir" desabilitado e não dispara nenhuma ação @spec:AC-404', async () => {
      usuarioAtual = { papel: 'ATENDENTE', isSuperAdmin: false };
      const perdido = itemPerdido({ lead: { id: 'l1', nome: 'Hospital Dia Barão', email: null, telefoneE164: null } });
      configurarArquivados({ todos: { itens: [perdido], total: 1 } });

      render(<PipelineArquivadosPage />);
      await screen.findByText('Hospital Dia Barão');

      const botao = await screen.findByRole('button', { name: /Reabrir Hospital Dia Barão \(apenas Master ou Gerente\)/ });
      expect(botao.getAttribute('aria-disabled')).toBe('true');

      const usuario = userEvent.setup();
      await usuario.click(botao);

      expect(chamadasReabrir).toHaveLength(0);
      expect(screen.queryByLabelText('Justificativa (obrigatória)')).toBeNull();
    });
  });

  describe('AC-405: os blocos de análise sem backend aparecem como "em breve"', () => {
    test('Análise de Motivos de Perda, Top Fechamentos e Playbook aparecem "em breve", sem disparar ação @spec:AC-405', async () => {
      configurarArquivados({ todos: { itens: [itemGanho()], total: 1 } });
      render(<PipelineArquivadosPage />);
      await screen.findByText('Cards Arquivados (Fechamentos)');

      const analise = screen.getByRole('button', { name: 'Análise de Motivos de Perda (em breve)' });
      const topFechamentos = screen.getByRole('button', { name: 'Top Fechamentos do Trimestre (em breve)' });
      const playbook = screen.getByRole('button', { name: 'Playbook de Reversão (em breve)' });

      for (const bloco of [analise, topFechamentos, playbook]) {
        expect(bloco.getAttribute('aria-disabled')).toBe('true');
      }

      const chamadasAntes = fetchFalso.mock.calls.length;
      const usuario = userEvent.setup();
      await usuario.click(analise);
      await usuario.click(topFechamentos);
      await usuario.click(playbook);

      expect(fetchFalso.mock.calls.length).toBe(chamadasAntes);
    });
  });
});
