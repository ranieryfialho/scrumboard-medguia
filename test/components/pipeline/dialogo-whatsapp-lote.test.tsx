// T-254 (fase5-whatsapp-lote-disparo, AC-685): o diálogo "Disparar WhatsApp" da lista.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DialogoWhatsappLote } from '../../../src/components/pipeline/lote/dialogo-whatsapp-lote';
import { BarraLote } from '../../../src/components/pipeline/lote/barra-lote';

const PREVIA = {
  template: { id: 't1', nome: 'Boas-vindas' },
  elegiveis: [{ leadId: 'l1' }, { leadId: 'l2' }],
  excluidos: [
    { leadId: 'l3', nome: 'Clínica Sem Consentimento', motivo: 'SEM_CONSENTIMENTO' },
    { leadId: 'l4', nome: null, motivo: 'LEAD_NAO_ENCONTRADO' },
  ],
  limite: 50,
  duracaoEstimadaSegundos: 30,
};

describe('T-254: diálogo de disparo em lote', () => {
  let chamadas: Array<{ url: string; init?: RequestInit }>;
  let previa: typeof PREVIA;
  let respostaDoLote: () => Response;

  beforeEach(() => {
    chamadas = [];
    previa = PREVIA;
    respostaDoLote = () => new Response(JSON.stringify({ loteId: 'lote-1', total: 2 }), { status: 201 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, init });
        if (url === '/api/whatsapp/templates') return new Response(JSON.stringify({ templates: [{ id: 't1', nome: 'Boas-vindas', status: 'aprovado' }, { id: 't2', nome: 'Rascunho', status: 'rascunho' }], podeGerir: true }));
        if (url === '/api/whatsapp/lote/previa') return new Response(JSON.stringify(previa));
        if (url === '/api/whatsapp/lote') return respostaDoLote();
        return new Response('{}', { status: 404 });
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('só os aprovados aparecem; escolher mostra a prévia com os motivos; confirmar cria o lote e oferece acompanhar @spec:AC-685', async () => {
    const u = userEvent.setup();
    render(<DialogoWhatsappLote oportunidadeIds={['c1', 'c2', 'c3', 'c4']} onFechar={() => undefined} />);
    const seletor = await screen.findByLabelText('Template aprovado');
    expect(within(seletor).queryByRole('option', { name: 'Rascunho' })).toBeNull();
    const confirmar = screen.getByRole('button', { name: /Confirmar envio/ }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);

    await u.selectOptions(seletor, 't1');
    const resumo = await screen.findByRole('region', { name: 'Prévia do lote' });
    expect(within(resumo).getByText(/2 receberão a mensagem · duração estimada 30 s/)).toBeTruthy();
    expect(within(resumo).getByText(/Limite de 50 por disparo, com 15 a 45 segundos/)).toBeTruthy();
    expect(within(resumo).getByText('Clínica Sem Consentimento — sem consentimento para WhatsApp')).toBeTruthy();
    expect(within(resumo).getByText('Lead não encontrado — lead não encontrado')).toBeTruthy();
    expect(JSON.parse(String(chamadas.find((c) => c.url === '/api/whatsapp/lote/previa')!.init!.body))).toEqual({ templateId: 't1', oportunidadeIds: ['c1', 'c2', 'c3', 'c4'] });

    const botao = screen.getByRole('button', { name: 'Confirmar envio de 2 mensagens' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);
    await u.click(botao);
    expect(await screen.findByText(/Lote criado: 2 mensagens entram na fila/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Acompanhar envio' }).getAttribute('href')).toBe('/whatsapp/lote');
    expect(JSON.parse(String(chamadas.find((c) => c.url === '/api/whatsapp/lote')!.init!.body))).toEqual({ templateId: 't1', oportunidadeIds: ['c1', 'c2', 'c3', 'c4'] });
  });

  test('sem nenhum elegível o botão fica desabilitado e a recusa do servidor aparece em português @spec:AC-685', async () => {
    const u = userEvent.setup();
    previa = { ...PREVIA, elegiveis: [], excluidos: [{ leadId: 'l3', nome: 'Sem Consentimento', motivo: 'SEM_CONSENTIMENTO' }] };
    render(<DialogoWhatsappLote oportunidadeIds={['c3']} onFechar={() => undefined} />);
    await u.selectOptions(await screen.findByLabelText('Template aprovado'), 't1');
    await screen.findByRole('region', { name: 'Prévia do lote' });
    expect((screen.getByRole('button', { name: /Confirmar envio/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    previa = PREVIA;
    respostaDoLote = () => new Response(JSON.stringify({ codigo: 'LOTE_EM_ANDAMENTO' }), { status: 409 });
    render(<DialogoWhatsappLote oportunidadeIds={['c1']} onFechar={() => undefined} />);
    await u.selectOptions(await screen.findByLabelText('Template aprovado'), 't1');
    await u.click(await screen.findByRole('button', { name: 'Confirmar envio de 2 mensagens' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Já existe um lote em andamento. Espere terminar ou cancele-o.');
  });

  test('na barra de lote o botão não é "em breve" e só aparece para quem pode disparar @spec:AC-685', async () => {
    const u = userEvent.setup();
    const abrir = vi.fn();
    const { rerender } = render(<BarraLote quantidade={2} podeReatribuir onAbrir={() => undefined} onDispararWhatsapp={abrir} />);
    const botao = screen.getByRole('button', { name: /Disparar WhatsApp/ });
    expect(botao.textContent!.toLowerCase()).not.toContain('em breve');
    await u.click(botao);
    expect(abrir).toHaveBeenCalledTimes(1);
    rerender(<BarraLote quantidade={2} podeReatribuir={false} onAbrir={() => undefined} onDispararWhatsapp={abrir} />);
    expect(screen.queryByRole('button', { name: /Disparar WhatsApp/ })).toBeNull();
  });
});
