// Testes de T-163 (fase4-pipeline-telas, US-109): a tela de detalhe do card
// (`src/app/(app)/pipeline/[id]/page.tsx`), com `CabecalhoCard`, `Jornada`,
// `Informacoes`, `LinhaDoTempo` e `RegistroRapido`. A página usa `use(params)`
// (React) — precisa de `Suspense` em volta, mesmo molde de
// test/components/pipeline/iniciar-cadencia.test.tsx. Um só roteador de
// `fetch` falso cobre `GET /api/oportunidades/:id` (T-048), `GET
// /api/oportunidades?etapaId=` (grafo filtrado por papel, T-046), `GET
// /api/leads/:id/telefones` (T-074), `GET /api/oportunidades/:id/linha-do-tempo`
// e `POST .../anotacoes` (T-157/T-156) e `POST .../transicao` (fase2-kanban,
// já existente). A casca (menu, topo) vem do layout do grupo `(app)`
// (T-146) e já está provada em test/components/shell/casca.test.tsx; aqui a
// prova é o que esta tela renderiza dentro dela.
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PipelineDetalhePage from '../../../src/app/(app)/pipeline/[id]/page';

const CARD_ID = 'ffffffff-1111-1111-1111-000000000163';

interface DetalheTeste {
  id: string;
  leadId: string;
  etapaId: number;
  leadNome: string;
  origem: string | null;
  email: string | null;
  criadoEm: string;
  responsavelId: string | null;
  responsavelNome: string | null;
  valor: string | null;
  proximaAcaoEm: string | null;
  version: number;
}

interface TelefoneTeste {
  numero: string;
  principal: boolean;
}

interface ItemLinhaTeste {
  id: string;
  tipo: string;
  texto: string;
  autorNome: string;
  ocorridoEm: string;
}

function diasAtras(dias: number): string {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000 - 60_000).toISOString();
}

function detalhePadrao(overrides: Partial<DetalheTeste> = {}): DetalheTeste {
  return {
    id: CARD_ID,
    leadId: 'lead-vitalis',
    etapaId: 6,
    leadNome: 'Clínica Vitalis',
    origem: 'Google Ads',
    email: 'contato@vitalis.com.br',
    criadoEm: diasAtras(5),
    responsavelId: 'resp-1',
    responsavelNome: 'Dra. Ana Souza',
    valor: '2500.00',
    proximaAcaoEm: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    version: 3,
    ...overrides,
  };
}

const TELEFONES_PADRAO: TelefoneTeste[] = [
  { numero: '+5511999990000', principal: true },
  { numero: '+5511888880000', principal: false },
];

function itemLinha(overrides: Partial<ItemLinhaTeste>): ItemLinhaTeste {
  return {
    id: 'ev-0',
    tipo: 'anotacao',
    texto: 'Evento',
    autorNome: 'Alguém',
    ocorridoEm: new Date().toISOString(),
    ...overrides,
  };
}

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response);
}

async function renderDetalhe(id: string = CARD_ID) {
  let resultado: ReturnType<typeof render>;
  await act(async () => {
    resultado = render(
      <Suspense fallback={null}>
        <PipelineDetalhePage params={Promise.resolve({ id })} />
      </Suspense>
    );
  });
  return resultado!;
}

let detalheAtual: DetalheTeste;
let cardNaoEncontrado: boolean;
let telefonesAtuais: TelefoneTeste[];
let alcancaveisAtuais: number[];
let linhaDoTempoItens: ItemLinhaTeste[];
let totalInteracoesAtual: number;
let filaTransicao: Array<() => Promise<Response>>;
let chamadasTransicao: Record<string, unknown>[];
let chamadasAnotacao: Record<string, unknown>[];

const fetchOriginal = globalThis.fetch;
let fetchFalso: ReturnType<typeof vi.fn>;

beforeEach(() => {
  detalheAtual = detalhePadrao();
  cardNaoEncontrado = false;
  telefonesAtuais = TELEFONES_PADRAO;
  alcancaveisAtuais = [];
  linhaDoTempoItens = [
    itemLinha({ id: 'ev-3', tipo: 'anotacao', texto: 'Anotação mais recente', autorNome: 'Felipe Dias', ocorridoEm: '2026-10-25T10:00:00.000Z' }),
    itemLinha({ id: 'ev-2', tipo: 'conexao_whatsapp', texto: 'Mensagem recebida via WhatsApp', autorNome: 'Sistema', ocorridoEm: '2026-10-20T09:00:00.000Z' }),
    itemLinha({ id: 'ev-1', tipo: 'transicao_etapa', texto: 'Entrou na etapa "Entrada de leads"', autorNome: 'Carlos Mendes', ocorridoEm: '2026-10-15T08:00:00.000Z' }),
  ];
  totalInteracoesAtual = 7;
  filaTransicao = [];
  chamadasTransicao = [];
  chamadasAnotacao = [];

  fetchFalso = vi.fn((url: string, init?: RequestInit) => {
    const analisada = new URL(url, 'http://localhost');
    const caminho = analisada.pathname;
    const metodo = init?.method ?? 'GET';

    if (caminho === `/api/oportunidades/${CARD_ID}` && metodo === 'GET') {
      if (cardNaoEncontrado) return resposta(404, { codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' });
      return resposta(200, detalheAtual);
    }
    if (caminho === '/api/oportunidades' && metodo === 'GET') {
      return resposta(200, { itens: [], grafo: { [detalheAtual.etapaId]: alcancaveisAtuais } });
    }
    if (caminho === `/api/leads/${detalheAtual.leadId}/telefones`) {
      return resposta(200, { telefones: telefonesAtuais });
    }
    if (caminho === `/api/oportunidades/${CARD_ID}/linha-do-tempo` && metodo === 'GET') {
      const tipo = analisada.searchParams.get('tipo');
      const itens = tipo ? linhaDoTempoItens.filter((item) => item.tipo === tipo) : linhaDoTempoItens;
      return resposta(200, { itens, totalInteracoes: totalInteracoesAtual });
    }
    if (caminho === `/api/oportunidades/${CARD_ID}/anotacoes` && metodo === 'POST') {
      const corpo = init?.body ? JSON.parse(init.body as string) : {};
      chamadasAnotacao.push(corpo);
      const nova: ItemLinhaTeste = {
        id: `nota-${chamadasAnotacao.length}`,
        tipo: 'anotacao',
        texto: corpo.texto,
        autorNome: 'Você',
        ocorridoEm: new Date().toISOString(),
      };
      linhaDoTempoItens = [nova, ...linhaDoTempoItens];
      totalInteracoesAtual += 1;
      return resposta(201, nova);
    }
    if (caminho === `/api/oportunidades/${CARD_ID}/transicao` && metodo === 'POST') {
      const corpo = init?.body ? JSON.parse(init.body as string) : {};
      chamadasTransicao.push(corpo);
      const proxima = filaTransicao.shift();
      if (proxima) return proxima();
      detalheAtual = { ...detalheAtual, etapaId: corpo.etapaDestinoId as number, version: detalheAtual.version + 1 };
      return resposta(200, { etapaId: detalheAtual.etapaId, version: detalheAtual.version });
    }
    if (caminho === '/api/motivos-perda') {
      return resposta(200, { itens: [{ id: 'motivo-1', nome: 'Preço acima do orçamento' }] });
    }
    return resposta(404, { codigo: 'NAO_ENCONTRADO' });
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
});

describe('T-163: tela de detalhe do card', () => {
  describe('AC-406: o detalhe mostra cabeçalho, etapa e jornada', () => {
    test('mostra o lead, a etapa atual, o responsável e a jornada com o percentual @spec:AC-406', async () => {
      await renderDetalhe();

      const titulo = await screen.findByRole('heading', { name: 'Clínica Vitalis', level: 1 });
      const blocoCabecalho = titulo.parentElement as HTMLElement;
      expect(within(blocoCabecalho).getByText('Qualificado p/ reunião')).toBeTruthy();
      expect(screen.getByText('Responsável: Dra. Ana Souza')).toBeTruthy();

      expect(screen.getByText('Jornada de Conversão (Etapa 6 de 15)')).toBeTruthy();
      expect(screen.getByText('40% Concluído')).toBeTruthy();
      // ASM-132: os nomes são os do banco, não os do protótipo.
      expect(screen.getByText('Teste (Trial)')).toBeTruthy();
      expect(screen.getByText('Negociação')).toBeTruthy();
    });
  });

  describe('AC-407: o detalhe mostra só os dados que o sistema tem', () => {
    test('mostra valor, origem, data de entrada, próxima ação vencida, telefones e e-mail @spec:AC-407', async () => {
      await renderDetalhe();
      await screen.findByText('Informações Principais');

      expect(screen.getByText(/R\$\s*2\.500,00/)).toBeTruthy();
      expect(screen.getByText('Google Ads')).toBeTruthy();
      expect(screen.getByText(/há 5 dias/)).toBeTruthy();
      expect(screen.getByText('Dra. Ana Souza')).toBeTruthy();
      expect(screen.getByText('Vencida')).toBeTruthy();
      expect(screen.getByText('+5511999990000')).toBeTruthy();
      expect(screen.getByText('+5511888880000')).toBeTruthy();
      expect(screen.getAllByText('Principal')).toHaveLength(1);
      expect(screen.getByText('contato@vitalis.com.br')).toBeTruthy();
    });

    test('não mostra os campos do protótipo sem dado no sistema @spec:AC-407', async () => {
      await renderDetalhe();
      await screen.findByText('Informações Principais');

      expect(screen.queryByText(/CNPJ/i)).toBeNull();
      expect(screen.queryByText(/estrutura da clínica/i)).toBeNull();
      expect(screen.queryByText(/valor anual/i)).toBeNull();
      expect(screen.queryByText(/unidade física/i)).toBeNull();
    });
  });

  describe('AC-408: a linha do tempo mostra o histórico real do card', () => {
    test('eventos do mais novo ao mais antigo, com tipo, texto, autor, data e a contagem de interações @spec:AC-408', async () => {
      await renderDetalhe();
      const cabecalhoLinha = await screen.findByText('Linha do Tempo de Atividades');
      const raiz = cabecalhoLinha.closest('[class*="rounded-xl"]') as HTMLElement;

      await waitFor(() => expect(within(raiz).getByText('7 interações')).toBeTruthy());

      const autores = Array.from(raiz.querySelectorAll('.font-label-lg.font-semibold')).map((el) => el.textContent);
      expect(autores).toEqual(['Felipe Dias', 'Sistema', 'Carlos Mendes']);

      expect(within(raiz).getByText('Anotação mais recente')).toBeTruthy();
      expect(within(raiz).getByText('Mensagem recebida via WhatsApp')).toBeTruthy();
      expect(within(raiz).getByText('Entrou na etapa "Entrada de leads"')).toBeTruthy();

      const botaoTodos = within(raiz).getByRole('button', { name: 'Todos' });
      expect(botaoTodos.getAttribute('aria-pressed')).toBe('true');
    });

    test('sem eventos, mostra o estado vazio @spec:AC-408', async () => {
      linhaDoTempoItens = [];
      totalInteracoesAtual = 0;

      await renderDetalhe();
      await screen.findByText('Linha do Tempo de Atividades');

      expect(await screen.findByText('Nenhuma interação ainda')).toBeTruthy();
    });
  });

  describe('AC-409: registrar uma anotação interna entra na linha do tempo', () => {
    test('escreve e salva: entra no topo da linha do tempo com o autor, e o campo é limpo @spec:AC-409', async () => {
      const usuario = userEvent.setup();
      await renderDetalhe();
      await screen.findByText('Linha do Tempo de Atividades');

      const campo = screen.getByLabelText('Anotação interna') as HTMLTextAreaElement;
      await usuario.type(campo, 'Cliente confirmou reunião para sexta');
      await usuario.click(screen.getByRole('button', { name: 'Salvar Registro' }));

      await waitFor(() => expect(chamadasAnotacao).toHaveLength(1));
      expect(chamadasAnotacao[0]).toEqual({ texto: 'Cliente confirmou reunião para sexta' });

      await waitFor(() => expect(screen.getByText('Cliente confirmou reunião para sexta')).toBeTruthy());
      expect(campo.value).toBe('');

      const raiz = screen.getByText('Linha do Tempo de Atividades').closest('[class*="rounded-xl"]') as HTMLElement;
      const autores = Array.from(raiz.querySelectorAll('.font-label-lg.font-semibold')).map((el) => el.textContent);
      expect(autores[0]).toBe('Você');
    });

    test('texto vazio (só espaços) não envia @spec:AC-409', async () => {
      const usuario = userEvent.setup();
      await renderDetalhe();
      await screen.findByText('Linha do Tempo de Atividades');

      const campo = screen.getByLabelText('Anotação interna');
      await usuario.type(campo, '   ');
      await usuario.click(screen.getByRole('button', { name: 'Salvar Registro' }));

      expect(chamadasAnotacao).toHaveLength(0);
    });
  });

  describe('AC-410: as ações de mover, ganho e perdido respeitam as regras do pipeline', () => {
    test('só as etapas de destino alcançáveis pelo papel aparecem @spec:AC-410', async () => {
      detalheAtual = detalhePadrao({ etapaId: 8 });
      alcancaveisAtuais = [9, 10, 14];

      await renderDetalhe();
      await screen.findByRole('heading', { name: 'Clínica Vitalis' });

      const select = (await screen.findByLabelText('Mover de Etapa')) as HTMLSelectElement;
      const opcoes = within(select)
        .getAllByRole('option')
        .map((opcao) => opcao.textContent);
      expect(opcoes).toEqual(['Mover de Etapa', 'No-show', 'Reunião realizada']);

      expect(screen.getByRole('button', { name: 'Perdido' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Marcar como Ganho' })).toBeNull();
    });

    test('escolher um destino que exige dado abre o modal, e confirmar aplica a transição na hora @spec:AC-410', async () => {
      detalheAtual = detalhePadrao({ etapaId: 8 });
      alcancaveisAtuais = [11];
      filaTransicao.push(() => resposta(400, { codigo: 'VALOR_OBRIGATORIO' }));

      const usuario = userEvent.setup();
      await renderDetalhe();
      const select = (await screen.findByLabelText('Mover de Etapa')) as HTMLSelectElement;

      await usuario.selectOptions(select, '11');

      expect(await screen.findByText('Informe o valor')).toBeTruthy();

      await usuario.type(screen.getByLabelText('Valor'), '3000');
      await usuario.click(screen.getByRole('button', { name: 'Confirmar' }));

      await waitFor(() => expect(chamadasTransicao).toHaveLength(2));
      expect(chamadasTransicao[1]).toEqual(
        expect.objectContaining({ etapaDestinoId: 11, valor: 3000 })
      );

      expect(screen.queryByText('Informe o valor')).toBeNull();
      await waitFor(() => {
        const titulo = screen.getByRole('heading', { name: 'Clínica Vitalis' });
        expect(within(titulo.parentElement as HTMLElement).getByText('Proposta')).toBeTruthy();
      });
    });

    test('"Perdido" exige motivo: abre o modal de motivo em vez de mover direto @spec:AC-410', async () => {
      detalheAtual = detalhePadrao({ etapaId: 8 });
      alcancaveisAtuais = [14];
      filaTransicao.push(() => resposta(400, { codigo: 'MOTIVO_PERDA_OBRIGATORIO' }));

      const usuario = userEvent.setup();
      await renderDetalhe();
      await usuario.click(await screen.findByRole('button', { name: 'Perdido' }));

      expect(await screen.findByText('Selecione o motivo da perda')).toBeTruthy();
      expect(chamadasTransicao).toHaveLength(1);
      expect(chamadasTransicao[0]).toEqual(expect.objectContaining({ etapaDestinoId: 14 }));
    });
  });

  describe('AC-411: o detalhe leva às abas das telas irmãs', () => {
    test('"Resumo" está ativa; as outras levam às rotas irmãs; itens sem backend são "em breve" @spec:AC-411', async () => {
      await renderDetalhe();
      await screen.findByRole('heading', { name: 'Clínica Vitalis' });

      expect(screen.getByText('Resumo')).toBeTruthy();
      expect(screen.queryByRole('link', { name: /Resumo/ })).toBeNull();

      expect(screen.getByRole('link', { name: /Cadência/ }).getAttribute('href')).toBe(`/pipeline/${CARD_ID}/cadencia`);
      expect(screen.getByRole('link', { name: /WhatsApp/ }).getAttribute('href')).toBe(`/pipeline/${CARD_ID}/conversa`);
      expect(screen.getByRole('link', { name: /Anexos/ }).getAttribute('href')).toBe(`/pipeline/${CARD_ID}/anexos`);

      const itensEmBreve = [
        screen.getByRole('button', { name: 'Editar Informações (em breve)' }),
        screen.getByRole('button', { name: 'Registrar Ligação (em breve)' }),
        screen.getByRole('button', { name: 'Agendar Reunião (em breve)' }),
        screen.getByRole('button', { name: 'Disparar WhatsApp (em breve)' }),
      ];
      for (const item of itensEmBreve) {
        expect(item.getAttribute('aria-disabled')).toBe('true');
      }

      const chamadasAntes = fetchFalso.mock.calls.length;
      const usuario = userEvent.setup();
      for (const item of itensEmBreve) {
        await usuario.click(item);
      }
      expect(fetchFalso.mock.calls.length).toBe(chamadasAntes);
    });
  });

  describe('AC-412: card de outra empresa ou inexistente mostra "não encontrado"', () => {
    test('id inexistente (ou de outra empresa, mesmo 404 fail-closed) mostra "não encontrado" com caminho de volta @spec:AC-412', async () => {
      cardNaoEncontrado = true;

      await renderDetalhe();

      expect(await screen.findByText('Card não encontrado')).toBeTruthy();
      const voltar = screen.getByRole('link', { name: /Voltar ao funil/ });
      expect(voltar.getAttribute('href')).toBe('/pipeline');

      expect(screen.queryByText('Clínica Vitalis')).toBeNull();
      expect(screen.queryByText('Informações Principais')).toBeNull();
    });
  });
});
