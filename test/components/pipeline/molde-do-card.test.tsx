// @vitest-environment jsdom
//
// Testes de T-171 (fase4-card-abas, US-111): o molde das telas do card —
// cabeçalho, barra de abas, contadores e os estados de carregando, erro e
// "não encontrado" (AC-419 a AC-422). Fetch falso, mesmo molde de
// test/components/pipeline/lista.test.tsx.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MoldeDoCard } from '../../../src/components/pipeline/card/molde-do-card';
import { ABAS_DO_CARD } from '../../../src/components/pipeline/card/abas-do-card';

const CARD_ID = 'cccccccc-0000-0000-0000-0000000000c1';

const CARD = {
  id: CARD_ID,
  leadId: 'lead-1',
  etapaId: 11,
  leadNome: 'Clínica Santa Luzia',
  responsavelNome: 'Karol Mendes',
  version: 3,
};

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response);
}

const fetchOriginal = globalThis.fetch;
let fetchFalso: ReturnType<typeof vi.fn>;
let respostaDoCard: () => Promise<Response>;

beforeEach(() => {
  respostaDoCard = () => resposta(200, CARD);
  fetchFalso = vi.fn((url: string) => {
    if (url === `/api/oportunidades/${CARD_ID}`) return respostaDoCard();
    if (url === `/api/oportunidades/${CARD_ID}/anexos`) return resposta(200, { anexos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    if (url === `/api/oportunidades/${CARD_ID}/cadencia`) {
      return resposta(200, { iniciada: true, concluidos: 2, total: 18 });
    }
    return resposta(404, { codigo: 'NAO_ENCONTRADO' });
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
});

function renderizar(aba: 'cadencia' | 'whatsapp' | 'anexos' = 'cadencia') {
  return render(
    <MoldeDoCard cardId={CARD_ID} aba={aba}>
      {(card) => <p>Conteúdo da aba de {card.leadNome}</p>}
    </MoldeDoCard>
  );
}

describe('T-171: molde do card', () => {
  describe('AC-419: as quatro abas levam a páginas que existem, e a ativa fica marcada', () => {
    test('as abas apontam para as quatro rotas e a da tela aberta fica marcada, sem link @spec:AC-419', async () => {
      renderizar('cadencia');
      await screen.findByText('Conteúdo da aba de Clínica Santa Luzia');

      const barra = screen.getByRole('navigation', { name: 'Abas do card' });
      expect(within(barra).getByRole('link', { name: /Resumo/ }).getAttribute('href')).toBe(`/pipeline/${CARD_ID}`);
      expect(within(barra).getByRole('link', { name: /WhatsApp/ }).getAttribute('href')).toBe(`/pipeline/${CARD_ID}/conversa`);
      expect(within(barra).getByRole('link', { name: /Anexos/ }).getAttribute('href')).toBe(`/pipeline/${CARD_ID}/anexos`);

      expect(within(barra).queryByRole('link', { name: /Cadência/ })).toBeNull();
      expect(within(barra).getByText(/Cadência/).closest('[aria-current="page"]')).toBeTruthy();
    });

    test('em cada uma das três telas novas, só a própria aba fica marcada @spec:AC-419', async () => {
      for (const aba of ['cadencia', 'whatsapp', 'anexos'] as const) {
        const { unmount } = renderizar(aba);
        await screen.findByText('Conteúdo da aba de Clínica Santa Luzia');

        const barra = screen.getByRole('navigation', { name: 'Abas do card' });
        const marcadas = barra.querySelectorAll('[aria-current="page"]');
        expect(marcadas).toHaveLength(1);
        const esperada = ABAS_DO_CARD.find((item) => item.chave === aba)!;
        expect(marcadas[0].textContent).toContain(esperada.rotulo);
        unmount();
      }
    });
  });

  describe('AC-420: o cabeçalho do card é o mesmo nas quatro telas', () => {
    test('mostra voltar ao funil, nome, selo da etapa e responsável @spec:AC-420', async () => {
      renderizar('anexos');
      await screen.findByText('Conteúdo da aba de Clínica Santa Luzia');

      expect(screen.getByRole('link', { name: /Voltar ao funil/ }).getAttribute('href')).toBe('/pipeline');
      expect(screen.getByRole('heading', { name: 'Clínica Santa Luzia' })).toBeTruthy();
      expect(screen.getByText('Proposta')).toBeTruthy();
      expect(screen.getByText('Responsável: Karol Mendes')).toBeTruthy();
      expect(screen.queryByText(/em breve/i)).toBeNull();
    });

    test('a foto do WhatsApp do lead aparece ao lado do nome, abaixo do "Voltar ao funil"', async () => {
      renderizar('whatsapp');
      const titulo = await screen.findByRole('heading', { name: 'Clínica Santa Luzia' });

      const foto = document.querySelector('img[src="/api/whatsapp/foto?leadId=lead-1"]')!;
      expect(foto).toBeTruthy();
      // a foto e o nome ficam na mesma linha, depois do link de voltar
      const linha = titulo.closest('.mt-1')!;
      expect(linha.contains(foto)).toBe(true);
      const voltar = screen.getByRole('link', { name: /Voltar ao funil/ });
      expect(voltar.compareDocumentPosition(foto) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('as abas mostram os toques feitos de 18 e o total de anexos @spec:AC-420', async () => {
      renderizar('cadencia');
      await screen.findByText('Conteúdo da aba de Clínica Santa Luzia');

      await waitFor(() => {
        const barra = screen.getByRole('navigation', { name: 'Abas do card' });
        expect(within(barra).getByText('2/18')).toBeTruthy();
        expect(within(barra).getByText('3')).toBeTruthy();
      });
    });

    test('se um contador falha, a tela segue e só o número fica de fora @spec:AC-420', async () => {
      fetchFalso.mockImplementation((url: string) =>
        url === `/api/oportunidades/${CARD_ID}` ? resposta(200, CARD) : resposta(500, {})
      );
      renderizar('cadencia');

      expect(await screen.findByText('Conteúdo da aba de Clínica Santa Luzia')).toBeTruthy();
      const barra = screen.getByRole('navigation', { name: 'Abas do card' });
      expect(within(barra).queryByText('2/18')).toBeNull();
    });
  });

  describe('AC-421: card de outra empresa ou inexistente mostra "não encontrado"', () => {
    test('404 mostra "Card não encontrado" com o caminho de volta e não desenha a aba @spec:AC-421', async () => {
      respostaDoCard = () => resposta(404, { codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' });
      renderizar('anexos');

      expect(await screen.findByText('Card não encontrado')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Voltar ao funil' }).getAttribute('href')).toBe('/pipeline');
      expect(screen.queryByText(/Conteúdo da aba/)).toBeNull();
      expect(screen.queryByRole('navigation', { name: 'Abas do card' })).toBeNull();
    });
  });

  describe('AC-422: cada tela tem estado de carregamento e de erro', () => {
    test('enquanto o card carrega, mostra o esqueleto @spec:AC-422', async () => {
      respostaDoCard = () => new Promise<Response>(() => undefined);
      renderizar('cadencia');

      expect(await screen.findByRole('status', { name: 'Carregando' })).toBeTruthy();
      expect(screen.queryByText(/Conteúdo da aba/)).toBeNull();
    });

    test('se a API falha, mostra o erro e "Tentar de novo" busca outra vez @spec:AC-422', async () => {
      const usuario = userEvent.setup();
      respostaDoCard = () => resposta(500, { codigo: 'ERRO' });
      renderizar('cadencia');

      const tentar = await screen.findByRole('button', { name: /Tentar de novo/ });
      respostaDoCard = () => resposta(200, CARD);
      await usuario.click(tentar);

      expect(await screen.findByText('Conteúdo da aba de Clínica Santa Luzia')).toBeTruthy();
    });
  });

  describe('AC-739: mover de etapa, ganho e perdido também nas abas', () => {
    test('lista os destinos que o papel alcança, move pela rota de transição e o cabeçalho mostra a etapa nova @spec:AC-739', async () => {
      const usuario = userEvent.setup();
      const base = fetchFalso.getMockImplementation()!;
      fetchFalso.mockImplementation((url: string, init?: RequestInit) => {
        if (url === '/api/oportunidades?etapaId=11') return resposta(200, { grafo: { 11: [12, 14, 15] } });
        if (url === `/api/oportunidades/${CARD_ID}/transicao` && init?.method === 'POST') return resposta(200, { etapaId: 12, version: 4 });
        return base(url);
      });
      renderizar('whatsapp');
      await screen.findByText('Conteúdo da aba de Clínica Santa Luzia');

      expect(await screen.findByRole('button', { name: 'Marcar como Ganho' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Perdido' })).toBeTruthy();
      const select = screen.getByLabelText('Mover de Etapa');
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Mover de Etapa', 'Teste (Trial)']);

      await usuario.selectOptions(select, '12');

      await waitFor(() => {
        const chamada = fetchFalso.mock.calls.find(([u]) => u === `/api/oportunidades/${CARD_ID}/transicao`)!;
        expect(JSON.parse((chamada[1] as RequestInit).body as string)).toEqual({ version: 3, etapaDestinoId: 12 });
      });
      const titulo = screen.getByRole('heading', { name: 'Clínica Santa Luzia' });
      await waitFor(() => expect(within(titulo.parentElement as HTMLElement).getByText('Teste (Trial)')).toBeTruthy());
    });

    test('quando falta dado (valor na Proposta, motivo na perda), abre o modal em vez de mover direto @spec:AC-739', async () => {
      const usuario = userEvent.setup();
      const base = fetchFalso.getMockImplementation()!;
      fetchFalso.mockImplementation((url: string, init?: RequestInit) => {
        if (url === '/api/oportunidades?etapaId=11') return resposta(200, { grafo: { 11: [14] } });
        if (url === `/api/oportunidades/${CARD_ID}/transicao` && init?.method === 'POST') return resposta(400, { codigo: 'MOTIVO_PERDA_OBRIGATORIO' });
        return base(url);
      });
      renderizar('anexos');
      await usuario.click(await screen.findByRole('button', { name: 'Perdido' }));

      expect(await screen.findByText('Selecione o motivo da perda')).toBeTruthy();
    });
  });
});
