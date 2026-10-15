// Testes de T-098 (fase2b-fila-tarefas, US-057): os botões de conclusão do
// toque (src/components/tarefas/toque-item.tsx) — "Sem resposta" (AC-208),
// "Conectou" (AC-209), mapeamento de erros (AC-210) e proteção contra
// clique duplo (AC-211). Mesmo molde de fetch falso de
// test/components/tarefas/fila-tarefas.test.tsx, mas sem precisar de
// `EventSource`/stream: este componente só reage a clique e repassa o
// resultado via `onAtualizarFila` — quem decide como recarregar é a tela
// (T-097), fora do escopo desta tarefa.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ToqueItem, type ItemToque } from '../../../src/components/tarefas/toque-item';

function itemToque(overrides: Partial<{ oportunidadeId: string; version: number; atividadeId: string; canal: 'telefone' | 'whatsapp' }> = {}): ItemToque {
  return {
    atividade: {
      id: overrides.atividadeId ?? 'atividade-1',
      sequencia: 1,
      canal: overrides.canal ?? 'telefone',
      tipo: 'ligacao',
    },
    oportunidade: { id: overrides.oportunidadeId ?? 'op-1', version: overrides.version ?? 3 },
    lead: { id: 'lead-1', nome: 'Maria Souza' },
    atrasado: false,
  };
}

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

describe('T-098: ToqueItem — botões de conclusão', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFalso = vi.fn();
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  describe('AC-208: "Sem resposta" conclui o toque e a fila se atualiza', () => {
    test('chama a rota de concluir com a version do card e recarrega a fila @spec:AC-208', async () => {
      fetchFalso.mockReturnValue(resposta(200, { resultado: 'sem_resposta' }));
      const onAtualizarFila = vi.fn();

      render(<ToqueItem item={itemToque({ oportunidadeId: 'op-77', version: 5 })} onAbrirConversa={vi.fn()} onAtualizarFila={onAtualizarFila} />);

      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole('button', { name: 'Sem resposta' }));

      await waitFor(() => expect(onAtualizarFila).toHaveBeenCalledTimes(1));

      expect(fetchFalso).toHaveBeenCalledTimes(1);
      const [url, opcoes] = fetchFalso.mock.calls[0];
      expect(url).toBe('/api/atividades/atividade-1/concluir');
      expect(opcoes.method).toBe('POST');
      expect(JSON.parse(opcoes.body)).toEqual({ version: 5, resultado: 'sem_resposta' });
    });
  });

  describe('AC-209: "Conectou" encerra a cadência e avisa para onde o card foi', () => {
    test('ao clicar em Conectou, avisa que o card foi para Qualificando e recarrega a fila @spec:AC-209', async () => {
      fetchFalso.mockReturnValue(resposta(200, { resultado: 'conectou' }));
      const onAtualizarFila = vi.fn();

      render(<ToqueItem item={itemToque()} onAbrirConversa={vi.fn()} onAtualizarFila={onAtualizarFila} />);

      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole('button', { name: 'Conectou' }));

      expect(await screen.findByText(/qualificando/i)).toBeTruthy();
      await waitFor(() => expect(onAtualizarFila).toHaveBeenCalledTimes(1));

      const [, opcoes] = fetchFalso.mock.calls[0];
      expect(JSON.parse(opcoes.body).resultado).toBe('conectou');
    });
  });

  describe('AC-210: erros de conclusão são explicados e a fila é recarregada', () => {
    test('409 CONFLITO_DE_VERSAO mostra mensagem específica e recarrega a fila @spec:AC-210', async () => {
      fetchFalso.mockReturnValue(resposta(409, { codigo: 'CONFLITO_DE_VERSAO' }));
      const onAtualizarFila = vi.fn();

      render(<ToqueItem item={itemToque()} onAbrirConversa={vi.fn()} onAtualizarFila={onAtualizarFila} />);

      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole('button', { name: 'Sem resposta' }));

      expect((await screen.findByRole('alert')).textContent).toMatch(/alterado por outra ação/i);
      await waitFor(() => expect(onAtualizarFila).toHaveBeenCalledTimes(1));
    });

    test('422 TURNO_NAO_LIBERADO mostra mensagem específica e recarrega a fila @spec:AC-210', async () => {
      fetchFalso.mockReturnValue(resposta(422, { codigo: 'TURNO_NAO_LIBERADO' }));
      const onAtualizarFila = vi.fn();

      render(<ToqueItem item={itemToque()} onAbrirConversa={vi.fn()} onAtualizarFila={onAtualizarFila} />);

      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole('button', { name: 'Sem resposta' }));

      expect((await screen.findByRole('alert')).textContent).toMatch(/não foi liberado/i);
      await waitFor(() => expect(onAtualizarFila).toHaveBeenCalledTimes(1));
    });

    test('422 CADENCIA_ENCERRADA mostra mensagem específica e recarrega a fila, sem duplicar nem perder toques @spec:AC-210', async () => {
      fetchFalso.mockReturnValue(resposta(422, { codigo: 'CADENCIA_ENCERRADA' }));
      const onAtualizarFila = vi.fn();

      render(<ToqueItem item={itemToque()} onAbrirConversa={vi.fn()} onAtualizarFila={onAtualizarFila} />);

      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole('button', { name: 'Conectou' }));

      expect((await screen.findByRole('alert')).textContent).toMatch(/cadência já foi encerrada/i);
      // Erro de "conectou" não deve mostrar o aviso de sucesso de AC-209.
      expect(screen.queryByText(/qualificando/i)).toBeFalsy();
      await waitFor(() => expect(onAtualizarFila).toHaveBeenCalledTimes(1));
    });
  });

  describe('AC-211: o botão não permite clique duplo', () => {
    test('dois cliques antes da resposta disparam só uma requisição e desabilitam os botões @spec:AC-211', async () => {
      let resolver!: (valor: unknown) => void;
      fetchFalso.mockReturnValue(
        new Promise((resolve) => {
          resolver = resolve;
        })
      );

      render(<ToqueItem item={itemToque()} onAbrirConversa={vi.fn()} onAtualizarFila={vi.fn()} />);

      const botaoSemResposta = screen.getByRole('button', { name: 'Sem resposta' });
      const botaoConectou = screen.getByRole('button', { name: 'Conectou' });

      // `fireEvent` dispara os cliques de forma síncrona, sem esperar o
      // React re-renderizar entre um e outro — exatamente o cenário que a
      // guarda via `ref` (não só o estado `enviando`) precisa cobrir: um
      // segundo clique antes de qualquer resposta (ou re-render) chegar.
      act(() => {
        fireEvent.click(botaoSemResposta);
        fireEvent.click(botaoSemResposta);
        fireEvent.click(botaoConectou);
      });

      expect(fetchFalso).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect((botaoSemResposta as HTMLButtonElement).disabled).toBe(true);
        expect((botaoConectou as HTMLButtonElement).disabled).toBe(true);
      });

      await act(async () => {
        resolver({ ok: true, status: 200, json: () => Promise.resolve({ resultado: 'sem_resposta' }) });
      });
      await waitFor(() => expect((botaoSemResposta as HTMLButtonElement).disabled).toBe(false));
    });
  });
});
