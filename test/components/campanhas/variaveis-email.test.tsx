// T-263 (fase5-email-config, AC-700): a explicação das variáveis, o botão Inserir e a prévia preenchida na tela de nova campanha.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NovaCampanha } from '../../../src/components/campanhas/nova-campanha';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

describe('T-263: variáveis na nova campanha', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).startsWith('/api/campanhas/previa-destinatarios')) return new Response(JSON.stringify({ porEtapa: [], total: 0, valorEmPipeline: 0 }));
        return new Response('{}', { status: 404 });
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('a seção explica {{nome}} e {{primeiro_nome}} com exemplo; Inserir coloca o shortcode onde está o cursor @spec:AC-700', async () => {
    const u = userEvent.setup();
    render(<NovaCampanha />);
    const ajuda = await screen.findByRole('region', { name: 'Variáveis disponíveis' });
    for (const codigo of ['{{nome}}', '{{primeiro_nome}}']) expect(within(ajuda).getByText(codigo)).toBeTruthy();
    expect(within(ajuda).getByText('O nome completo do lead, como está no cadastro.')).toBeTruthy();
    expect(within(ajuda).getByText(/vira "Maria Souza"/)).toBeTruthy();
    expect(within(ajuda).getByText(/vira "Maria"/)).toBeTruthy();

    const corpo = screen.getByLabelText('Corpo do e-mail') as HTMLTextAreaElement;
    await u.click(corpo);
    await u.paste('Olá, ! Tudo bem?');
    corpo.setSelectionRange(5, 5);
    await u.click(within(ajuda).getByRole('button', { name: 'Inserir {{primeiro_nome}}' }));
    expect(corpo.value).toBe('Olá, {{primeiro_nome}}! Tudo bem?');
  });

  test('a prévia do e-mail mostra o corpo já preenchido com o nome de exemplo @spec:AC-700', async () => {
    const u = userEvent.setup();
    render(<NovaCampanha />);
    const corpo = await screen.findByLabelText('Corpo do e-mail');
    await u.click(corpo);
    await u.paste('<p>Olá, {{primeiro_nome}}! ({{nome}})</p>');
    const previa = screen.getByTitle('Prévia do e-mail') as HTMLIFrameElement;
    expect(previa.getAttribute('srcdoc')).toBe('<p>Olá, Maria! (Maria Souza)</p>');
    expect(previa.getAttribute('sandbox')).toBe(''); // a prévia continua isolada
  });
});
