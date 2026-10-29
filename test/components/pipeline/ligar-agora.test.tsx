// T-234 (fase5-acoes-rapidas, US-151): "Ligar Agora" na conversa do card abre o discador.
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import PipelineConversaPage from '../../../src/app/(app)/pipeline/[id]/conversa/page';

const CARD_ID = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

describe('T-234: Ligar Agora', () => {
  const fetchOriginal = globalThis.fetch;
  let telefone: string | null;

  beforeEach(() => {
    telefone = '5511999990000';
    globalThis.fetch = vi.fn((url: string) => {
      if (url === `/api/oportunidades/${CARD_ID}`) return resposta(200, { id: CARD_ID, leadId: LEAD_ID, etapaId: 11, leadNome: 'Clínica Santa Luzia', responsavelNome: null, version: 1, telefoneE164: telefone });
      if (url.includes('/anexos')) return resposta(200, { anexos: [] });
      if (url.includes('/linha-do-tempo')) return resposta(200, { itens: [] });
      if (url.includes('/cadencia')) return resposta(200, { atividades: [] });
      if (url.includes('/whatsapp/messages')) return resposta(200, { mensagens: [] });
      return resposta(200, {});
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  async function montar() {
    await act(async () => {
      render(
        <Suspense fallback={null}>
          <PipelineConversaPage params={Promise.resolve({ id: CARD_ID })} />
        </Suspense>
      );
    });
  }

  test('com telefone, "Ligar Agora" é um link tel: com o número do lead @spec:AC-645', async () => {
    await montar();
    expect((await screen.findByRole('link', { name: /Ligar Agora/ })).getAttribute('href')).toBe('tel:+5511999990000');
  });

  test('sem telefone o botão não aparece @spec:AC-645', async () => {
    telefone = null;
    await montar();
    await screen.findByText(/A conversa de Clínica Santa Luzia/);
    expect(screen.queryByText('Ligar Agora')).toBeNull();
  });
});
