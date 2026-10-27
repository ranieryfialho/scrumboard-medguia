// @vitest-environment jsdom
//
// Testes de T-178 (fase4-pipeline-lote): a barra de ações em lote da lista
// (`/pipeline/lista`) — mover, reatribuir e arquivar os cards marcados, com o
// resultado "N feitos, M não" e o motivo de cada falha. Fetch falso; as APIs de
// lote têm prova própria nos testes do servidor (T-176/T-177).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let paramsIniciais = new URLSearchParams();
const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => paramsIniciais,
}));

import PipelineListaPage from '../../../src/app/(app)/pipeline/lista/page';

const MOTIVO_PRECO = 'mmmmmmmm-0000-0000-0000-000000000001';
const RESPONSAVEL_ANA = 'rrrrrrrr-0000-0000-0000-000000000001';

function item(id: string, nome: string) {
  return {
    id,
    etapaId: 1,
    valor: '1000.00',
    proximaAcaoEm: null,
    lead: { id: `lead-${id}`, nome, email: null, telefoneE164: null, origem: 'Google Ads' },
    responsavel: { id: 'resp-1', nome: 'Carlos Mendes' },
  };
}

const ITENS = [item('c1', 'Clínica Alfa'), item('c2', 'Clínica Beta'), item('c3', 'Clínica Gama')];

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response);
}

const fetchOriginal = globalThis.fetch;
let fetchFalso: ReturnType<typeof vi.fn>;
let papel: string;
let respostaDoLote: () => Promise<Response>;

function postsDeLote(acao: string) {
  return fetchFalso.mock.calls.filter(
    ([url, init]) => url === `/api/oportunidades/lote/${acao}` && (init as RequestInit | undefined)?.method === 'POST'
  );
}

function corpoDoPost(acao: string, indice = 0) {
  return JSON.parse((postsDeLote(acao)[indice][1] as RequestInit).body as string);
}

function leiturasDaLista() {
  return fetchFalso.mock.calls.filter(([url]) => {
    const u = new URL(url as string, 'http://localhost');
    return u.pathname === '/api/oportunidades/lista' && u.searchParams.has('pagina');
  }).length;
}

beforeEach(() => {
  paramsIniciais = new URLSearchParams();
  routerReplace.mockClear();
  papel = 'GERENTE';
  respostaDoLote = () => resposta(200, { resultados: [], aplicados: 0, falhas: 0 });

  fetchFalso = vi.fn((url: string) => {
    const u = new URL(url, 'http://localhost');
    if (u.pathname === '/api/oportunidades/lista') {
      return resposta(200, { itens: ITENS, total: ITENS.length, pagina: 1, porPagina: u.searchParams.has('pagina') ? 10 : 50 });
    }
    if (u.pathname === '/api/me') return resposta(200, { papel, isSuperAdmin: false });
    if (u.pathname === '/api/pipeline/responsaveis') {
      return resposta(200, { responsaveis: [{ id: RESPONSAVEL_ANA, nome: 'Ana Souza', papel: 'ATENDENTE' }] });
    }
    if (u.pathname === '/api/motivos-perda') return resposta(200, { itens: [{ id: MOTIVO_PRECO, nome: 'Preço' }] });
    if (u.pathname.startsWith('/api/oportunidades/lote/')) return respostaDoLote();
    return resposta(404, { codigo: 'NAO_ENCONTRADO' });
  });
  // O `fetch` do POST usa a mesma função; precisa devolver respostaDoLote() só no POST.
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
});

async function abrirComSelecionados(nomes: string[]) {
  const usuario = userEvent.setup();
  render(<PipelineListaPage />);
  await screen.findByText(nomes[0]);
  for (const nome of nomes) await usuario.click(screen.getByLabelText(`Selecionar ${nome}`));
  return usuario;
}

describe('T-178: ações em lote na lista', () => {
  describe('AC-445: marcar cards mostra a barra de ações em lote com o que funciona', () => {
    test('mostra "N selecionados" e as três ações funcionando; "Disparar WhatsApp" fica "em breve" @spec:AC-445', async () => {
      await abrirComSelecionados(['Clínica Alfa', 'Clínica Beta']);

      expect(screen.getByText('2 selecionados')).toBeTruthy();
      for (const rotulo of ['Mover Etapa em Lote', 'Reatribuir Comercial', 'Arquivar']) {
        const botao = screen.getByRole('button', { name: new RegExp(rotulo) }) as HTMLButtonElement;
        expect(botao.disabled).toBe(false);
      }
      // O item "em breve" é o contêiner do rótulo (rótulo + selo).
      expect(screen.getByText('Disparar WhatsApp').parentElement!.textContent!.toLowerCase()).toContain('em breve');
    });

    test('"Disparar WhatsApp" não dispara nada e sem marcação a barra some @spec:AC-445', async () => {
      const usuario = await abrirComSelecionados(['Clínica Alfa']);

      const antes = fetchFalso.mock.calls.length;
      await usuario.click(screen.getByText('Disparar WhatsApp'));
      expect(fetchFalso.mock.calls.length).toBe(antes);

      await usuario.click(screen.getByLabelText('Selecionar Clínica Alfa'));
      expect(screen.queryByText(/selecionados/)).toBeNull();
      expect(screen.queryByRole('button', { name: /Mover Etapa em Lote/ })).toBeNull();
    });
  });

  describe('AC-446: mover em lote usa as mesmas regras da transição de um card', () => {
    test('escolher a etapa e confirmar manda os ids e a etapa ao servidor e recarrega a lista @spec:AC-446', async () => {
      respostaDoLote = () =>
        resposta(200, { resultados: [{ id: 'c1', ok: true }, { id: 'c2', ok: true }], aplicados: 2, falhas: 0 });
      const usuario = await abrirComSelecionados(['Clínica Alfa', 'Clínica Beta']);
      const leiturasAntes = leiturasDaLista();

      await usuario.click(screen.getByRole('button', { name: /Mover Etapa em Lote/ }));
      const dialogo = screen.getByRole('dialog', { name: 'Mover Etapa em Lote' });
      const confirmar = within(dialogo).getByRole('button', { name: 'Mover 2 cards' }) as HTMLButtonElement;
      expect(confirmar.disabled).toBe(true);
      expect(within(dialogo).getAllByRole('option')).toHaveLength(16); // placeholder + 15 etapas

      await usuario.selectOptions(within(dialogo).getByLabelText('Etapa de destino'), '3');
      await usuario.click(confirmar);

      await waitFor(() => expect(postsDeLote('mover')).toHaveLength(1));
      expect(corpoDoPost('mover')).toEqual({ ids: ['c1', 'c2'], etapaDestinoId: 3 });
      await waitFor(() => expect(leiturasDaLista()).toBeGreaterThan(leiturasAntes));
      expect(await screen.findByText('2 movidos')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('AC-447: falha parcial aplica nos que dão e lista os que não', () => {
    test('mostra "N movidos, M não movidos" com o lead e o motivo, e deixa marcado só quem falhou @spec:AC-447', async () => {
      respostaDoLote = () =>
        resposta(200, {
          resultados: [
            { id: 'c1', ok: true },
            { id: 'c2', ok: false, codigo: 'TRANSICAO_NAO_PERMITIDA' },
            { id: 'c3', ok: false, codigo: 'PROXIMA_ACAO_OBRIGATORIA' },
          ],
          aplicados: 1,
          falhas: 2,
        });
      const usuario = await abrirComSelecionados(['Clínica Alfa', 'Clínica Beta', 'Clínica Gama']);

      await usuario.click(screen.getByRole('button', { name: /Mover Etapa em Lote/ }));
      await usuario.selectOptions(within(screen.getByRole('dialog')).getByLabelText('Etapa de destino'), '7');
      await usuario.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mover 3 cards' }));

      const painel = await screen.findByRole('region', { name: 'Resultado da ação em lote' });
      expect(within(painel).getByText('1 movidos, 2 não movidos')).toBeTruthy();
      expect(within(painel).getByText(/Clínica Beta/).parentElement!.textContent).toContain('Essa etapa não pode ser alcançada');
      expect(within(painel).getByText(/Clínica Gama/).parentElement!.textContent).toContain('Falta informar a próxima ação');
      expect(within(painel).queryByText(/Clínica Alfa/)).toBeNull();

      await waitFor(() => expect(screen.getByText('2 selecionados')).toBeTruthy());
      expect((screen.getByLabelText('Selecionar Clínica Alfa') as HTMLInputElement).checked).toBe(false);
      expect((screen.getByLabelText('Selecionar Clínica Beta') as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText('Selecionar Clínica Gama') as HTMLInputElement).checked).toBe(true);
    });

    test('o painel de resultado se fecha e uma falha do pedido inteiro mostra a mensagem sem fechar o diálogo @spec:AC-447', async () => {
      respostaDoLote = () => resposta(400, { codigo: 'REQUISICAO_INVALIDA' });
      const usuario = await abrirComSelecionados(['Clínica Alfa']);

      await usuario.click(screen.getByRole('button', { name: /Mover Etapa em Lote/ }));
      await usuario.selectOptions(within(screen.getByRole('dialog')).getByLabelText('Etapa de destino'), '2');
      await usuario.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mover 1 card' }));

      expect((await screen.findByRole('alert')).textContent).toContain('Seleção inválida');
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  describe('AC-450: reatribuir muda o responsável de todos os selecionados', () => {
    test('lista os responsáveis ativos, manda o escolhido e mostra "N reatribuídos" @spec:AC-450', async () => {
      respostaDoLote = () =>
        resposta(200, { resultados: [{ id: 'c1', ok: true }, { id: 'c2', ok: true }], aplicados: 2, falhas: 0 });
      const usuario = await abrirComSelecionados(['Clínica Alfa', 'Clínica Beta']);

      await usuario.click(screen.getByRole('button', { name: /Reatribuir Comercial/ }));
      const dialogo = await screen.findByRole('dialog', { name: 'Reatribuir Comercial' });
      await within(dialogo).findByRole('option', { name: 'Ana Souza' });

      await usuario.selectOptions(within(dialogo).getByLabelText('Novo responsável'), RESPONSAVEL_ANA);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Reatribuir 2 cards' }));

      await waitFor(() => expect(postsDeLote('reatribuir')).toHaveLength(1));
      expect(corpoDoPost('reatribuir')).toEqual({ ids: ['c1', 'c2'], responsavelId: RESPONSAVEL_ANA });
      expect(await screen.findByText('2 reatribuídos')).toBeTruthy();
    });
  });

  describe('AC-451: só MASTER e GERENTE reatribuem', () => {
    test('ATENDENTE vê "Reatribuir Comercial" desabilitado e não abre o diálogo @spec:AC-451', async () => {
      papel = 'ATENDENTE';
      await abrirComSelecionados(['Clínica Alfa']);

      await waitFor(() => {
        expect((screen.getByRole('button', { name: /Reatribuir Comercial/ }) as HTMLButtonElement).disabled).toBe(true);
      });
      expect((screen.getByRole('button', { name: /Mover Etapa em Lote/ }) as HTMLButtonElement).disabled).toBe(false);
    });

    test('responsável recusado pelo servidor mostra o motivo e mantém o diálogo aberto @spec:AC-451', async () => {
      respostaDoLote = () => resposta(400, { codigo: 'RESPONSAVEL_INVALIDO' });
      const usuario = await abrirComSelecionados(['Clínica Alfa']);

      await usuario.click(screen.getByRole('button', { name: /Reatribuir Comercial/ }));
      const dialogo = await screen.findByRole('dialog', { name: 'Reatribuir Comercial' });
      await within(dialogo).findByRole('option', { name: 'Ana Souza' });
      await usuario.selectOptions(within(dialogo).getByLabelText('Novo responsável'), RESPONSAVEL_ANA);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Reatribuir 1 card' }));

      expect((await screen.findByRole('alert')).textContent).toContain('não está ativo');
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  describe('AC-453: arquivar leva os selecionados para "Perdido" com o motivo escolhido', () => {
    test('manda os ids e o motivo, mostra "N arquivados" e recarrega a lista @spec:AC-453', async () => {
      respostaDoLote = () =>
        resposta(200, { resultados: [{ id: 'c1', ok: true }, { id: 'c2', ok: true }], aplicados: 2, falhas: 0 });
      const usuario = await abrirComSelecionados(['Clínica Alfa', 'Clínica Beta']);
      const leiturasAntes = leiturasDaLista();

      await usuario.click(screen.getByRole('button', { name: /^Arquivar/ }));
      const dialogo = await screen.findByRole('dialog', { name: 'Arquivar cards' });
      await within(dialogo).findByRole('option', { name: 'Preço' });
      await usuario.selectOptions(within(dialogo).getByLabelText('Motivo da perda'), MOTIVO_PRECO);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Arquivar 2 cards' }));
      await usuario.click(within(dialogo).getByRole('button', { name: 'Confirmar: arquivar 2 cards' }));

      await waitFor(() => expect(postsDeLote('arquivar')).toHaveLength(1));
      expect(corpoDoPost('arquivar')).toEqual({ ids: ['c1', 'c2'], motivoPerdaId: MOTIVO_PRECO });
      expect(await screen.findByText('2 arquivados')).toBeTruthy();
      await waitFor(() => expect(leiturasDaLista()).toBeGreaterThan(leiturasAntes));
    });
  });

  describe('AC-454: arquivar exige o motivo e confirma antes de agir', () => {
    test('sem motivo não confirma, e o primeiro clique só pede a confirmação com a quantidade @spec:AC-454', async () => {
      const usuario = await abrirComSelecionados(['Clínica Alfa', 'Clínica Beta', 'Clínica Gama']);

      await usuario.click(screen.getByRole('button', { name: /^Arquivar/ }));
      const dialogo = await screen.findByRole('dialog', { name: 'Arquivar cards' });
      await within(dialogo).findByRole('option', { name: 'Preço' });
      expect((within(dialogo).getByRole('button', { name: 'Arquivar 3 cards' }) as HTMLButtonElement).disabled).toBe(true);

      await usuario.selectOptions(within(dialogo).getByLabelText('Motivo da perda'), MOTIVO_PRECO);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Arquivar 3 cards' }));

      expect(postsDeLote('arquivar')).toHaveLength(0);
      expect(within(dialogo).getByRole('status').textContent).toContain('3 cards como perdidos');
      expect(within(dialogo).getByRole('button', { name: 'Confirmar: arquivar 3 cards' })).toBeTruthy();
    });

    test('trocar o motivo desfaz a confirmação, e cancelar fecha sem enviar nada @spec:AC-454', async () => {
      const usuario = await abrirComSelecionados(['Clínica Alfa']);

      await usuario.click(screen.getByRole('button', { name: /^Arquivar/ }));
      const dialogo = await screen.findByRole('dialog', { name: 'Arquivar cards' });
      await within(dialogo).findByRole('option', { name: 'Preço' });
      await usuario.selectOptions(within(dialogo).getByLabelText('Motivo da perda'), MOTIVO_PRECO);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Arquivar 1 card' }));
      expect(within(dialogo).getByRole('button', { name: 'Confirmar: arquivar 1 card' })).toBeTruthy();

      await usuario.selectOptions(within(dialogo).getByLabelText('Motivo da perda'), '');
      expect(within(dialogo).queryByRole('button', { name: /Confirmar/ })).toBeNull();

      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(postsDeLote('arquivar')).toHaveLength(0);
    });
  });
});
