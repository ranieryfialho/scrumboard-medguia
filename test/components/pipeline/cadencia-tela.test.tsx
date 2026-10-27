// @vitest-environment jsdom
//
// Testes de T-173 (fase4-card-abas, US-113): a tela da cadência de 18 toques
// (`/pipeline/[id]/cadencia`), dentro do `MoldeDoCard`. Fetch falso; a matriz
// dos 18 toques vem do próprio domínio (`blocoDe`), para a fixture não divergir
// do sistema. O molde (cabeçalho e abas) tem prova própria em molde-do-card.test.tsx.
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PipelineCadenciaPage from '../../../src/app/(app)/pipeline/[id]/cadencia/page';
import { blocoDe, type Dia } from '../../../src/domain/cadencia/matriz';
import type { CadenciaDoCardView, ToqueDaCadencia } from '../../../src/components/pipeline/cadencia/tipos';

const CARD_ID = 'cccccccc-0000-0000-0000-0000000000c1';
const CARD = { id: CARD_ID, leadId: 'lead-1', etapaId: 2, leadNome: 'Clínica Santa Luzia', responsavelNome: 'Karol Mendes', version: 3 };

const BLOCOS: ReadonlyArray<{ dia: Dia; turno: 'manha' | 'tarde' }> = [
  { dia: 1, turno: 'manha' },
  { dia: 1, turno: 'tarde' },
  { dia: 2, turno: 'manha' },
  { dia: 2, turno: 'tarde' },
  { dia: 3, turno: 'manha' },
  { dia: 3, turno: 'tarde' },
];

/** Os 18 toques da matriz real; os `concluidos` primeiros viram "concluido" e o seguinte "da_vez". */
function montarCadencia(
  concluidos: Array<{ resultado: 'conectou' | 'sem_resposta'; quando: string; quem: string }>,
  extras: Partial<CadenciaDoCardView> = {}
): CadenciaDoCardView {
  const toques: ToqueDaCadencia[] = BLOCOS.flatMap(({ dia, turno }) => blocoDe(dia, turno)).map((previsto, indice) => {
    const feito = concluidos[indice];
    const daVez = !feito && indice === concluidos.length;
    return {
      sequencia: previsto.sequencia,
      dia: previsto.dia,
      turno: previsto.turno,
      canal: previsto.canal,
      tipo: previsto.tipo,
      estado: feito ? 'concluido' : daVez ? 'da_vez' : 'programado',
      atividadeId: feito || daVez ? `ativ-${previsto.sequencia}` : null,
      resultado: feito ? feito.resultado : daVez ? 'pendente' : null,
      realizadaEm: feito ? feito.quando : null,
      realizadaPor: feito ? { id: 'u1', nome: feito.quem } : null,
      observacao: null,
      atrasado: false,
    };
  });
  const conectou = concluidos.filter((c) => c.resultado === 'conectou').length;
  return {
    oportunidade: { id: CARD_ID, etapaId: 2, version: 3 },
    iniciada: true,
    encerrada: false,
    situacao: 'em_andamento',
    total: 18,
    concluidos: concluidos.length,
    conectou,
    semResposta: concluidos.length - conectou,
    toqueDaVez: toques.find((t) => t.estado === 'da_vez') ?? null,
    toques,
    ...extras,
  };
}

const DOIS_FEITOS = [
  { resultado: 'conectou' as const, quando: '2026-10-27T12:00:00.000Z', quem: 'Ana Clara' },
  { resultado: 'sem_resposta' as const, quando: '2026-10-27T13:30:00.000Z', quem: 'Diego Ramos' },
];

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response);
}

const fetchOriginal = globalThis.fetch;
let fetchFalso: ReturnType<typeof vi.fn>;
let cadenciaDoServidor: CadenciaDoCardView;
let respostaDaCadencia: () => Promise<Response>;
let respostaDoConcluir: () => Promise<Response>;
let respostaDoIniciar: () => Promise<Response>;

function chamadas(metodo: 'GET' | 'POST', caminho: string) {
  return fetchFalso.mock.calls.filter(
    ([url, init]) => url === caminho && ((init as RequestInit | undefined)?.method ?? 'GET') === metodo
  );
}

beforeEach(() => {
  cadenciaDoServidor = montarCadencia(DOIS_FEITOS);
  respostaDaCadencia = () => resposta(200, cadenciaDoServidor);
  respostaDoConcluir = () => resposta(200, {});
  respostaDoIniciar = () => resposta(200, { oportunidade: { etapaId: 2, version: 4 }, toques: [] });
  fetchFalso = vi.fn((url: string, init?: RequestInit) => {
    if (url === `/api/oportunidades/${CARD_ID}`) return resposta(200, CARD);
    if (url === `/api/oportunidades/${CARD_ID}/cadencia`) return respostaDaCadencia();
    if (url === `/api/oportunidades/${CARD_ID}/anexos`) return resposta(200, { anexos: [] });
    if (url === `/api/oportunidades/${CARD_ID}/cadencia/iniciar` && init?.method === 'POST') return respostaDoIniciar();
    if (url.startsWith('/api/atividades/') && url.endsWith('/concluir') && init?.method === 'POST') return respostaDoConcluir();
    return resposta(404, { codigo: 'NAO_ENCONTRADO' });
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
});

async function montar() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PipelineCadenciaPage params={Promise.resolve({ id: CARD_ID })} />
      </Suspense>
    );
  });
}

async function abrirTela() {
  await montar();
  await screen.findByRole('region', { name: 'Toque da vez' });
}

describe('T-173: tela da cadência de 18 toques', () => {
  describe('AC-431: o resumo do topo mostra progresso, toque da vez, respostas e situação da régua', () => {
    test('mostra "N de 18", a barra, o toque da vez, as respostas e a situação @spec:AC-431', async () => {
      await abrirTela();

      const barra = screen.getByRole('progressbar', { name: 'Progresso da cadência' });
      expect(barra.getAttribute('aria-valuenow')).toBe('2');
      expect(barra.getAttribute('aria-valuemax')).toBe('18');
      expect(screen.getByText('16 toques restantes')).toBeTruthy();

      const atual = screen.getByRole('heading', { name: 'Toque Atual' }).closest('section')!;
      expect(within(atual).getByText('Toque #3')).toBeTruthy();
      expect(within(atual).getByText(/Dia 1 · Turno Manhã/)).toBeTruthy();

      const respostas = screen.getByRole('heading', { name: 'Respostas Obtidas' }).closest('section')!;
      expect(within(respostas).getByText('1 sem resposta')).toBeTruthy();
      expect(within(respostas).getByText(/conexão/)).toBeTruthy();

      const situacao = screen.getByRole('heading', { name: 'Status da Régua' }).closest('section')!;
      expect(within(situacao).getByText('Em andamento')).toBeTruthy();
    });

    test('toque atrasado vira "Com toque atrasado"; cadência encerrada não tem toque da vez @spec:AC-431', async () => {
      cadenciaDoServidor = montarCadencia(DOIS_FEITOS, { situacao: 'atrasada' });
      await abrirTela();
      expect(within(screen.getByRole('heading', { name: 'Status da Régua' }).closest('section')!).getByText('Com toque atrasado')).toBeTruthy();
      cleanup();

      cadenciaDoServidor = montarCadencia(DOIS_FEITOS, { situacao: 'encerrada', encerrada: true, toqueDaVez: null });
      await montar();
      await screen.findByText('Cadência encerrada');
      expect(screen.queryByRole('region', { name: 'Toque da vez' })).toBeNull();
    });

    test('taxa de engajamento e SLA do protótipo não aparecem @spec:AC-431', async () => {
      await abrirTela();

      expect(screen.queryByText(/engajamento/i)).toBeNull();
      expect(screen.queryByText(/\bSLA\b/)).toBeNull();
    });
  });

  describe('AC-432: a matriz mostra os 18 toques por dia e turno com o estado de cada um', () => {
    test('três dias, turnos Manhã e Tarde com 3 toques cada, e o contador de cada dia @spec:AC-432', async () => {
      await abrirTela();

      const matriz = screen.getByRole('region', { name: 'Matriz de 18 toques' });
      for (const dia of [1, 2, 3]) expect(within(matriz).getByRole('heading', { name: `Dia ${dia}` })).toBeTruthy();
      expect(within(matriz).getAllByText(/^Turno Manhã \(Toques/)).toHaveLength(3);
      expect(within(matriz).getAllByText(/^Turno Tarde \(Toques/)).toHaveLength(3);
      expect(within(matriz).getByText('Turno Manhã (Toques 1 a 3)')).toBeTruthy();
      expect(within(matriz).getByText('Turno Tarde (Toques 16 a 18)')).toBeTruthy();

      expect(within(matriz).getByText('2/6 concluídos')).toBeTruthy();
      expect(within(matriz).getAllByText('0/6 concluídos')).toHaveLength(2);
      expect(matriz.querySelectorAll('li')).toHaveLength(18);
    });

    test('cada toque mostra o estado: concluído com resultado, da vez em destaque e programado @spec:AC-432', async () => {
      await abrirTela();

      const matriz = screen.getByRole('region', { name: 'Matriz de 18 toques' });
      expect(matriz.querySelectorAll('li[data-estado="concluido"]')).toHaveLength(2);
      expect(matriz.querySelectorAll('li[data-estado="da_vez"]')).toHaveLength(1);
      expect(matriz.querySelectorAll('li[data-estado="programado"]')).toHaveLength(15);

      const primeiro = matriz.querySelector('li[data-sequencia="1"]') as HTMLElement;
      expect(within(primeiro).getByText('Conectou')).toBeTruthy();
      expect(within(primeiro).getByText(/Ana Clara/)).toBeTruthy();
      const segundo = matriz.querySelector('li[data-sequencia="2"]') as HTMLElement;
      expect(within(segundo).getByText('Sem resposta')).toBeTruthy();
      expect(within(matriz.querySelector('li[data-sequencia="3"]') as HTMLElement).getByText('Toque da vez')).toBeTruthy();
      expect(within(matriz.querySelector('li[data-sequencia="18"]') as HTMLElement).getByText(/Mensagem de despedida/)).toBeTruthy();
      // Ligação não repete o rótulo ("Ligação · Ligação"); mensagem leva o canal.
      expect(within(primeiro).getByText('Ligação telefônica')).toBeTruthy();
      expect(within(matriz.querySelector('li[data-sequencia="3"]') as HTMLElement).queryByText(/Ligação · Ligação/)).toBeNull();
    });
  });

  describe('AC-433: sem cadência iniciada, a tela mostra o caminho para iniciar', () => {
    test('mostra o vazio com "Iniciar cadência" e, ao usar, a matriz aparece sem recarregar a página @spec:AC-433', async () => {
      const usuario = userEvent.setup();
      cadenciaDoServidor = { ...montarCadencia([]), iniciada: false, situacao: 'nao_iniciada', toqueDaVez: null };
      cadenciaDoServidor.toques = cadenciaDoServidor.toques.map((t) => ({ ...t, estado: 'programado', atividadeId: null, resultado: null }));
      cadenciaDoServidor.oportunidade = { id: CARD_ID, etapaId: 1, version: 1 };
      await montar();

      expect(await screen.findByText('A cadência deste card ainda não foi iniciada')).toBeTruthy();
      expect(screen.queryByRole('region', { name: 'Matriz de 18 toques' })).toBeNull();

      cadenciaDoServidor = montarCadencia([]);
      await usuario.click(screen.getByRole('button', { name: 'Iniciar cadência' }));

      await waitFor(() => expect(chamadas('POST', `/api/oportunidades/${CARD_ID}/cadencia/iniciar`)).toHaveLength(1));
      expect(await screen.findByRole('region', { name: 'Matriz de 18 toques' })).toBeTruthy();
    });
  });

  describe('AC-434: concluir o toque da vez pela tela, com as regras da cadência', () => {
    test('"Registrar Sucesso" conclui como "conectou" e a tela avança para o próximo toque @spec:AC-434', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      cadenciaDoServidor = montarCadencia([...DOIS_FEITOS, { resultado: 'conectou', quando: '2026-10-27T14:00:00.000Z', quem: 'Alana Prado' }]);
      await usuario.click(screen.getByRole('button', { name: /Registrar Sucesso/ }));

      await waitFor(() => expect(chamadas('POST', '/api/atividades/ativ-3/concluir')).toHaveLength(1));
      const corpo = JSON.parse((chamadas('POST', '/api/atividades/ativ-3/concluir')[0][1] as RequestInit).body as string);
      expect(corpo).toEqual({ version: 3, resultado: 'conectou' });

      await waitFor(() => {
        expect(screen.getByRole('progressbar', { name: 'Progresso da cadência' }).getAttribute('aria-valuenow')).toBe('3');
      });
      expect(within(screen.getByRole('heading', { name: 'Toque Atual' }).closest('section')!).getByText('Toque #4')).toBeTruthy();
    });

    test('"Não Atendeu" conclui como "sem resposta" @spec:AC-434', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      await usuario.click(screen.getByRole('button', { name: /Não Atendeu/ }));

      await waitFor(() => expect(chamadas('POST', '/api/atividades/ativ-3/concluir')).toHaveLength(1));
      const corpo = JSON.parse((chamadas('POST', '/api/atividades/ativ-3/concluir')[0][1] as RequestInit).body as string);
      expect(corpo.resultado).toBe('sem_resposta');
    });

    test.each([
      [422, 'TURNO_NAO_LIBERADO', 'ainda não foi liberado'],
      [422, 'BLOCO_ANTERIOR_PENDENTE', 'bloco anterior'],
      [422, 'CADENCIA_ENCERRADA', 'já foi encerrada'],
      [409, 'CONFLITO_DE_VERSAO', 'Outra pessoa mexeu'],
    ])('recusa %i %s mostra o motivo e nada muda @spec:AC-434', async (status, codigo, trecho) => {
      const usuario = userEvent.setup();
      await abrirTela();

      respostaDoConcluir = () => resposta(status, { codigo });
      await usuario.click(screen.getByRole('button', { name: /Registrar Sucesso/ }));

      expect((await screen.findByRole('alert')).textContent).toContain(trecho);
      expect(screen.getByRole('progressbar', { name: 'Progresso da cadência' }).getAttribute('aria-valuenow')).toBe('2');
    });
  });

  describe('AC-435: o histórico lista os toques já feitos, com atalho para a conversa', () => {
    test('lista do mais novo ao mais antigo, com "Ver conversa" só nos de WhatsApp @spec:AC-435', async () => {
      await abrirTela();

      const historico = screen.getByRole('region', { name: 'Histórico de interações da régua' });
      const linhas = within(historico).getAllByRole('row').slice(1);
      expect(linhas).toHaveLength(2);
      expect(within(linhas[0]).getByText(/^#2 · Dia 1/)).toBeTruthy();
      expect(within(linhas[1]).getByText(/^#1 · Dia 1/)).toBeTruthy();
      expect(within(linhas[0]).getByText('Diego Ramos')).toBeTruthy();

      const links = within(historico).queryAllByRole('link', { name: 'Ver conversa' });
      const doWhatsapp = cadenciaDoServidor.toques.filter((t) => t.estado === 'concluido' && t.canal === 'whatsapp');
      expect(links).toHaveLength(doWhatsapp.length);
      for (const link of links) expect(link.getAttribute('href')).toBe(`/pipeline/${CARD_ID}/conversa`);
    });

    test('o filtro por canal restringe a lista @spec:AC-435', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      const historico = screen.getByRole('region', { name: 'Histórico de interações da régua' });
      await usuario.selectOptions(within(historico).getByLabelText('Filtrar por canal'), 'whatsapp');

      const esperadas = cadenciaDoServidor.toques.filter((t) => t.estado === 'concluido' && t.canal === 'whatsapp').length;
      const restantes = within(historico).queryAllByRole('row').slice(1);
      if (esperadas === 0) {
        expect(within(historico).getByText('Nenhum toque feito neste canal.')).toBeTruthy();
      } else {
        expect(restantes).toHaveLength(esperadas);
      }
    });
  });

  describe('AC-436: ações e blocos da cadência sem backend', () => {
    test('pausar, reiniciar, retorno mais tarde, exportar e editar script ficam "em breve" e não disparam nada @spec:AC-436', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      for (const rotulo of ['Pausar Cadência', 'Reiniciar Régua', 'Pediu Retorno Mais Tarde', 'Exportar Relatório (PDF)', 'Editar Script']) {
        expect(screen.getByText(rotulo).closest('*[class*="rounded"]')!.textContent!.toLowerCase()).toContain('em breve');
      }

      const antes = fetchFalso.mock.calls.length;
      await usuario.click(screen.getByText('Pausar Cadência'));
      await usuario.click(screen.getByText('Pediu Retorno Mais Tarde'));
      expect(fetchFalso.mock.calls.length).toBe(antes);
    });

    test('o script recomendado do protótipo não aparece @spec:AC-436', async () => {
      await abrirTela();

      expect(screen.queryByText(/script recomendado/i)).toBeNull();
    });
  });

  describe('AC-422: a tela tem estado de erro', () => {
    test('se a cadência falha, mostra o erro e "Tentar de novo" busca outra vez @spec:AC-422', async () => {
      const usuario = userEvent.setup();
      respostaDaCadencia = () => resposta(500, { codigo: 'ERRO' });
      await montar();

      const tentar = await screen.findByRole('button', { name: /Tentar de novo/ });
      respostaDaCadencia = () => resposta(200, cadenciaDoServidor);
      await usuario.click(tentar);

      expect(await screen.findByRole('region', { name: 'Toque da vez' })).toBeTruthy();
    });
  });
});
